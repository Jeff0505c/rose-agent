'use strict';
/**
 * ROSE 引擎层
 * 统一接口：createTurn(session, userText) -> TurnHandle
 *  CodexEngine：驱动项目内 vendor codex app-server（每角色一个 CODEX_HOME 线程库，
 *               JSON-RPC 2.0 over stdio）—— codex 开源 harness 作为 agent loop 底层。
 *
 * 线程身份模型（v0.18 起）：
 *  - 线程身份 = 会话（sessionId → 唯一 threadId，全生命周期不变）；
 *  - 模型 / 厂商 / 沙箱 / 审批 / 模式 都是「每轮注入的参数」；
 *  - 会话内切换任何参数 → 同一线程续跑，无重建、无回放（上下文原生延续）；
 *  - 进程（重）启 / LRU / MCP invalidate 后经 thread/resume 恢复线程；
 *  - 线程丢失/首次消息才 thread/start 新建（v0.18.1 起回放机制已移除，新建即空线程）。
 *
 * TurnHandle 事件（通过 onEvent 回调发出）：
 *  { type:'text-delta', delta }                        助手文本增量
 *  { type:'reasoning-delta', delta }                   思考摘要增量
 *  { type:'tool-start', toolId, name, args }           工具调用开始
 *  { type:'tool-end', toolId, ok, output }             工具调用结束
 *  { type:'approval-request', requestId, title, command, reason } 审批请求
 *  { type:'turn-complete' }                            本轮结束
 *  { type:'error', message }                           出错
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const skills = require('./skills');
const mcp = require('./mcp');
const platform = require('./platform');

const ROOT = process.env.ROSE_ROOT || path.resolve(__dirname, '..', '..');
// 优先用 core/vendor/ 内的官方预编译二进制（项目自包含），其次 npm 本地包。
// 平台分支集中此处（M4 Windows 唯一需要扩的点）；打包态二进制经 extraResources 位于 Resources/vendor/。
// 平台能力层决定二进制名；不受支持的组合回退历史默认（保持既有行为不回归）
const CODEX_BIN_NAME = platform.codexBinName()
  || (process.platform === 'win32' ? 'codex-x86_64-pc-windows-msvc.exe' : 'codex-aarch64-apple-darwin');
function resolveCodexBin() {
  const cands = [
    path.join(process.resourcesPath || '', 'vendor', CODEX_BIN_NAME),
    path.join(__dirname, 'vendor', CODEX_BIN_NAME),   // 开发态：core/vendor/
  ];
  return cands.find((p) => { try { return p && fs.existsSync(p); } catch { return false; } }) || cands[1];
}
const VENDOR_BIN = resolveCodexBin();
const NPM_BIN = path.join(ROOT, 'node_modules', '.bin', 'codex');
const CODEX_BIN = fs.existsSync(VENDOR_BIN) ? VENDOR_BIN : NPM_BIN;
// CODEX_HOME 必须可写：打包后 core/ 位于只读 asar 内，故由 main.js 通过 env 重定向到 userData。
const CODEX_HOME = process.env.ROSE_CODEX_HOME || path.join(__dirname, '.codex-home');
// 随包本地工具目录（如 github-mcp-server）：打包态=Resources/tools；开发态=仓库 tools/
// 注意：必须按**存在性**挑，不能只看 process.resourcesPath——开发态跑 Electron 时它指向
// Electron 自带的 Resources（不存在 tools/），会把随包工具误判为缺失（自检误报、MCP 起不来）。
function resolveToolsDir() {
  const cands = [
    process.resourcesPath ? path.join(process.resourcesPath, 'tools') : null,
    path.join(ROOT, 'tools'),
    path.resolve(__dirname, '..', '..', 'tools'),
  ].filter(Boolean);
  return cands.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || cands[cands.length - 1];
}
const TOOLS_DIR = resolveToolsDir();
// MCP stdio 命令解析：非绝对路径视为随包工具名（如 "github-mcp-server"），解析到 TOOLS_DIR；
// 找不到则原样返回（交由 codex 自行按 PATH 解析）。避免把机器绝对路径写进默认注册表。
function resolveToolCommand(cmd) {
  if (typeof cmd !== 'string' || !cmd) return cmd;
  const isAbs = cmd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cmd);
  if (isAbs) return cmd;
  const r = platform.resolveCommand(cmd, process.platform, TOOLS_DIR);
  const rAbs = r.startsWith('/') || /^[A-Za-z]:[\\/]/.test(r);
  if (!rAbs) return r;                       // 包管理器/解释器/shell 内建：走 PATH（Windows 补 .cmd/.exe）
  return fs.existsSync(r) ? r : cmd;         // 随包工具存在才用，否则回退原命令（保持旧行为）
}

/**
 * 展开注册表里的路径占位符 —— 让**出厂默认注册表**可以不含任何机器绝对路径：
 *   ${ROSE_ROOT}        → 用户数据根（ROOT）
 *   ${ROSE_WORK}        → ROOT/work
 *   ${ROSE_CODEX_HOME}  → CODEX_HOME
 * 只在「生成 config.toml / 探测 MCP」时展开；注册表本身始终保存占位符（可跨机拷贝）。
 * 未知占位符原样保留（不猜、不吞）。
 */
function expandVars(v) {
  if (typeof v !== 'string' || v.indexOf('${') < 0) return v;
  const map = {
    ROSE_ROOT: ROOT,
    ROSE_WORK: path.join(ROOT, 'work'),
    ROSE_CODEX_HOME: CODEX_HOME,
  };
  return v.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (m, k) => (map[k] !== undefined ? map[k] : m));
}
// 会话 → codex 线程 映射的磁盘持久化（线程身份=会话；threadId 存于角色级 CODEX_HOME sqlite）
const THREADS_PATH = path.join(ROOT, 'work', 'data', 'engine-threads.json');

// 会话级运行策略默认（沙箱 / 审批）。角色不再承载策略，由会话对话框选择。
const DEFAULT_SANDBOX = 'workspace-write';
const DEFAULT_APPROVAL = 'on-request';
const SANDBOX_MAP = { 'read-only': 'read-only', 'workspace-write': 'workspace-write', 'danger-full-access': 'danger-full-access' };
const APPROVAL_MAP = { 'on-request': 'on-request', 'never': 'never' };
// 归一化会话策略：非法/缺失回退默认；返回 { sandbox, approval }
// Plan 模式下强制只读（计划阶段只研究不执行，与 codex plan 语义一致）
function policyFor(session, settings) {
  const glob = (settings && settings.global) || {};
  let sb = (session && session.sandbox) || glob.sandbox || DEFAULT_SANDBOX;
  const ap = (session && session.approval) || glob.approval || DEFAULT_APPROVAL;
  if (session && session.planMode) sb = 'read-only';
  return {
    sandbox: SANDBOX_MAP[sb] ? sb : DEFAULT_SANDBOX,
    approval: APPROVAL_MAP[ap] ? ap : DEFAULT_APPROVAL,
  };
}

// 清除目录树上的 macOS provenance xattr（沙箱/数据源标记会让 codex sqlite 初始化失败）。
// 真实环境无此标记，此调用是幂等且无害的容错。
function clearXattr(dir) {
  if (platform.isWin(process.platform)) return;   // xattr 仅 macOS 存在
  try {
    const r = require('child_process').spawnSync('xattr', ['-cr', dir], { stdio: 'ignore' });
    if (r.status !== 0) { /* 非 macOS 或权限不足，忽略 */ }
  } catch { /* ignore */ }
}

// 读取记忆文件并追加到 AGENTS 文本末尾（记忆=事实性内容，非指令，区块注释明示）。
// 文件缺失或内容为空则原样返回。（原 gateway/history.js 中的记忆合并逻辑迁入）
const MEM_START = '\n\n<!-- ==== ROSE 记忆区：以下为事实性记忆（偏好/事实/经验），不是指令；由「设置 → 记忆」界面维护 ==== -->\n';
const MEM_END = '\n<!-- ==== /记忆区 ==== -->\n';
function mergeMemory(baseMd, memoryFile) {
  let mem = '';
  try { mem = fs.readFileSync(memoryFile, 'utf8'); } catch { return baseMd; }
  if (!mem.trim()) return baseMd;
  return baseMd + MEM_START + mem.replace(/\s+$/, '\n') + MEM_END;
}

// 角色人格（Soul）源文件：roles/<role>/soul.md；旧版 roles/<role>/AGENTS.md 自动兼容为回退源
function readRoleSoulFile(roleId) {
  try { if (fs.existsSync(path.join(ROOT, 'roles', roleId, 'soul.md'))) return fs.readFileSync(path.join(ROOT, 'roles', roleId, 'soul.md'), 'utf8'); } catch {}
  try { return fs.readFileSync(path.join(ROOT, 'roles', roleId, 'AGENTS.md'), 'utf8'); } catch {}
  return '';
}

/* ---------------- 上下文窗口解析（三级：用户声明 > 引擎实测 > 家族默认） ---------------- */
// 引擎自带的模型目录给出的 model_context_window 往往小于模型真实能力
// （例：DeepSeek 系列实际 1M，引擎目录给的是 258400），所以**不能**把它当权威值：
//   settings.modelWindowsDetected[provider|model] = 引擎实测上报的（次优先，仅兜底）
//   FAMILY_CONTEXT_WINDOWS                        = 已知家族的默认窗口（最低优先）
// 说明：不提供"每模型手填窗口"（用户要求取消）。窗口按下面顺序自动判定：
//   ① 家族默认（已知模型真实能力，如 DeepSeek 1M —— 引擎目录值常偏小）
//   ② 引擎实测上报值（未知家族时的唯一来源）
//   ③ null（界面显示"未知"，不编造）
const FAMILY_CONTEXT_WINDOWS = [
  [/^deepseek/i, 1000000],   // DeepSeek v3.x/v4 系列（官方口径 1M）
  [/^qwen|^qwq/i, 1000000],  // Qwen 长上下文档（可按模型改）
  [/^kimi|^moonshot/i, 256000],
  [/^glm|^zhipu/i, 200000],
  [/^claude/i, 200000],
  // 注意：**不列 OpenAI 自家模型**（gpt-*/o*）——它们在 codex 内置目录里，
  // 引擎上报的窗口（如 272000，gpt-5.4 的 max 可到 1M）才是权威值，家族表别去覆盖它。
];
function familyWindow(modelId) {
  for (const [re, v] of FAMILY_CONTEXT_WINDOWS) if (re.test(String(modelId || ''))) return v;
  return null;
}
// codex 0.152.1 内置目录（从 vendor 二进制提取：slug → 窗口/上限）。
// **未收录的 slug 一律回退到默认条目**（窗口=上限=272000）——这就是 BYO 模型"只能用 258k"的来源。
const ENGINE_CATALOG = {
  'gpt-5.6-sol': { window: 272000, max: 872000 },
  'gpt-5.6-terra': { window: 272000, max: 872000 },
  'gpt-5.6-luna': { window: 272000, max: 872000 },
  'gpt-daybreak-blue-latest': { window: 272000, max: 872000 },
  'gpt-daybreak-red-latest': { window: 372000, max: 372000 },
  'gpt-5.5': { window: 272000, max: 272000 },
  'gpt-5.4': { window: 272000, max: 1000000 },
  'gpt-5.4-mini': { window: 272000, max: 272000 },
  'gpt-5.2': { window: 272000, max: 272000 },
  'codex-auto-review': { window: 272000, max: 872000 },
};
const ENGINE_CATALOG_FALLBACK = { window: 272000, max: 272000 };
function engineCatalogEntry(modelId) {
  return ENGINE_CATALOG[String(modelId || '')] || ENGINE_CATALOG_FALLBACK;
}

/**
 * 上下文预算（**唯一真源**：config.toml 与设置页都用它，避免两处算不一样）。
 * 规则（全部对应本机实测）：
 *  - 引擎可用窗口 = 目标窗口 × 95%；
 *  - 目标窗口 ≤ 引擎目录该模型（或回退条目）的窗口，否则会被静默丢弃；
 *  - 引擎实测值只用来"向上修正"（覆盖被采纳、或目录与我们记录的不同），绝不向下收敛，
 *    否则每轮都会把自己的窗口越算越小（自我缩水）。
 */
function contextBudget(settings, providerId, modelId) {
  const cat = engineCatalogEntry(modelId);
  const fam = resolveContextWindow(settings, providerId, modelId);
  const detected = ((settings.modelWindowsDetected || {})[`${providerId}|${modelId}`]);
  const pctRaw = Number(settings.global && settings.global.autoCompactPercent);
  const pct = Number.isFinite(pctRaw) && pctRaw >= 10 && pctRaw <= 99 ? pctRaw : 80;

  let target = Math.min(fam || cat.window, cat.window);   // 家族真实能力与引擎上限取小
  let usable = Math.round(target * 0.95);
  // 引擎实测窗口比我们记录的更大 → 说明配置真的生效了（例如目录放行到 1M）：实测是权威，
  // 把 target/usable 一起抬上去。⚠️ 只抬 usable 不抬 target 会写出
  // `model_context_window = 272000` + `model_auto_compact_token_limit = 760000` 这种自相矛盾的配置
  // （阈值大于声明窗口 → 引擎若校验 threshold≤window 会整份回落默认，压缩行为也不可预期）。
  if (typeof detected === 'number' && detected > usable) { usable = detected; target = Math.max(target, detected); }
  const limit = Math.max(1000, Math.min(Math.floor((usable * pct) / 100), Math.floor(usable * 0.9)));
  return { target, usable, pct, threshold: limit, detected: detected || null, family: fam || null, catalog: cat };
}

function resolveContextWindow(settings, providerId, modelId) {
  const key = `${providerId}|${modelId}`;
  // ① 已知真实能力优先：先按模型名判家族，模型名不认识时再看 provider
  //   （同一 provider 下常出现自定义/别名模型名，如 deepseek provider + "v4.1-flash"）
  const fam = familyWindow(modelId) || familyWindow(providerId);
  if (typeof fam === 'number' && fam > 0) return fam;
  const detected = (settings.modelWindowsDetected || {})[key];
  if (typeof detected === 'number' && detected > 0) return detected;  // ② 引擎实测兜底
  return null;                                                // ③ 未知
}

/* ---------------- Codex 引擎（真实） ---------------- */

class CodexEngine {
  constructor(cfg) {
    this.cfg = cfg;               // settings.json 内容（启动快照，作为兜底）
    this.configSource = null;     // 实时配置读取器：由 services 注入（见 setConfigSource）
    this.name = 'codex';
    this.procs = new Map();       // roleId -> st（每角色一个 app-server 进程；参数每轮注入）
    this.threads = new Map();     // sessionId -> { roleId, threadId, cwd }（线程身份=会话）
    this.turnByThread = new Map(); // threadId -> TurnHandle
    this.turnProc = new Map();     // threadId -> st：承载该 turn 的进程（LRU 不得回收、进程退出要失败它）
    this.turnIds = new Map();      // threadId -> 当前 turnId（turn/steer 插话需要 expectedTurnId）
    this._homeLocks = new Map();  // 角色 home 目录 → spawn 串行锁（避免并发写同一 config.toml 竞态）
    this.pendingElicitations = new Set(); // requestId（mcpServer/elicitation/request 远程 MCP 工具授权门 待 UI 决策）
    this.globalListeners = new Set();     // 引擎级事件出口（沙箱状态等非 turn 绑定事件）
    this.recentStderr = [];               // codex 子进程 stderr 环形缓冲（诊断导出用；不落盘）
    this._sandboxCache = null;            // { at, value } —— readiness 结果短缓存
    this.sandboxSetupState = { running: false, mode: null, startedAt: 0, lastResult: null };
    this._loadThreads();          // 从磁盘恢复会话线程映射（线程在角色线程库中，进程重启后经 thread/resume 恢复）
  }

  /**
   * 注入实时配置读取器。**必须注入**：settings.json 可能在应用启动后被用户改动
   * （最常见的就是新增/修改模型 Provider），若引擎一直用启动时的快照，
   * 生成的 config.toml 里就没有该 provider，codex 会报
   * `failed to load configuration: Model provider \`xxx\` not found`。
   */
  setConfigSource(fn) { this.configSource = typeof fn === 'function' ? fn : null; }

  /** 反查：线程 → 会话（全局事件只有 threadId，需要映射回会话才能广播给正确的前端会话） */
  sessionIdForThread(threadId) {
    if (!threadId) return null;
    for (const [sid, t] of this.threads) if (t && t.threadId === threadId) return sid;
    return null;
  }

  /** 取当前配置：优先实时读取，失败/未注入回退启动快照 */
  _getSettings() {
    if (this.configSource) {
      try {
        const live = this.configSource();
        if (live && typeof live === 'object') return live;
      } catch (e) { process.stderr.write('[engine] 读取实时配置失败，回退启动快照：' + ((e && e.message) || e) + '\n'); }
    }
    return this.cfg || {};
  }

  // ---- 线程映射持久化（data/engine-threads.json；身份=会话；provider 变化时需重建线程）----
  _loadThreads() {
    try {
      const j = JSON.parse(fs.readFileSync(THREADS_PATH, 'utf8'));
      const s = (j && j.sessions) || {};
      for (const [id, t] of Object.entries(s)) {
        // 现行格式：{ roleId, threadId, cwd, providerId, modelId }。
        // 旧格式（无 providerId）也加载，但 createTurn 检测到 providerId 缺失/不一致时重建线程补记。
        if (t && typeof t.threadId === 'string' && typeof t.roleId === 'string') {
          this.threads.set(id, { roleId: t.roleId, threadId: t.threadId, cwd: t.cwd, providerId: t.providerId, modelId: t.modelId });
        }
      }
    } catch { /* 首次运行/无文件：空映射 */ }
  }
  _persistThreads() {
    try {
      const obj = { sessions: Object.fromEntries(this.threads) };
      fs.mkdirSync(path.dirname(THREADS_PATH), { recursive: true });
      const tmp = THREADS_PATH + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, THREADS_PATH);
    } catch (e) { process.stderr.write('[engine] 线程映射持久化失败: ' + (e && e.message) + '\n'); }
  }

  get available() {
    try { return fs.existsSync(CODEX_BIN); } catch { return false; }
  }

  // 角色级 CODEX_HOME：该角色所有会话/参数共享同一线程库（线程身份=会话，参数每轮注入）
  _roleHome(roleId) {
    const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const home = path.join(CODEX_HOME, 'runs', safe(roleId));
    fs.mkdirSync(home, { recursive: true });
    // 角色 home 里有 config.toml（可能含 MCP 密钥）、sqlite 历史 → 只给本用户
    try { fs.chmodSync(home, 0o700); } catch { /* 平台不支持时忽略 */ }
    return home;
  }

  // 同一 home 的 spawn（写 config.toml + 启动进程）串行化：config.toml 是共享单文件，
  // 避免两个参数组合并发首启时互相覆盖导致进程读到错误配置
  _withHomeLock(home, fn) {
    const prev = this._homeLocks.get(home) || Promise.resolve();
    const next = prev.then(fn, fn);
    this._homeLocks.set(home, next.catch(() => {}));
    return next;
  }

  // 把 config.toml 写入角色 home。基线（默认 model_provider/model/sandbox/approval）取 spawn 时的参数组合，
  // 但**注册全部厂商**——模型/厂商/沙箱/审批/模式都按轮在 turn/start 上注入，进程只需认识所有厂商即可。
  _writeConfig(role, providerId, modelId, sandbox, approval, home) {
    const settings = this._getSettings();
    const lines = [];
    lines.push('# ROSE 运行配置（动态生成，勿手改；模型/厂商/沙箱/审批均按轮注入）');
    lines.push('');
    if (providerId !== 'openai') lines.push(`model_provider = ${JSON.stringify(providerId)}`);
    lines.push(`model = ${JSON.stringify(modelId)}`);
    lines.push(`sandbox_mode = ${JSON.stringify(sandbox)}`);
    lines.push(`approval_policy = ${JSON.stringify(approval)}`);
    lines.push('');
    // 子代理能力（激活条件见 roles/_global/AGENTS-GLOBAL.md「子代理激活条件」，经 AGENTS 每会话加载）
    lines.push('multi_agent_v2 = true');
    lines.push('max_depth = 1');
    lines.push('max_concurrent_threads_per_session = 2');
    lines.push('');

    // ⚠️ TOML 顺序铁律：**顶层键必须写在任何 [table] 之前**。曾把 [features.token_budget] 插在
    // developer_instructions 前面，导致后面的顶层键被吞进那张表 → 引擎报 "data did not match any
    // variant of untagged enum FeatureToml" → **整份配置回落默认**（厂商/模型/人格全丢）→ 对话跑不通。
    // ① L0 确定性裁剪：限制单条工具输出（不花模型调用、不改写历史，先剪后摘）
    const toolLimitRaw = Number(settings.global && settings.global.toolOutputTokenLimit);
    const toolLimit = Number.isFinite(toolLimitRaw) && toolLimitRaw >= 500 ? Math.round(toolLimitRaw) : 8000;
    lines.push(`tool_output_token_limit = ${toolLimit}`);
    lines.push('');

    // ② 窗口与阈值：统一走 contextBudget（与设置页展示同一个函数，避免两处数字不一致）
    const budget = contextBudget(settings, providerId, modelId);
    if (budget.target > 0) {
      lines.push(`model_context_window = ${budget.target}`);
      lines.push(`model_auto_compact_token_limit = ${budget.threshold}`);
      lines.push('');
    }

    // developer_instructions = 角色人格（Soul）+ 角色记忆（激活条件已在全局 AGENTS 层维护）
    const soulTxt = mergeMemory(readRoleSoulFile(role.id), path.join(ROOT, 'roles', role.id, 'MEMORY.md'));
    if (soulTxt.trim()) {
      lines.push(`developer_instructions = ${JSON.stringify(soulTxt.trim())}`);
      lines.push('');
    }
    // 全部厂商注册（每轮 modelProvider 注入需要）。
    // 跳过 codex 内置保留 ID（openai/ollama/lmstudio）：它们不可被 [model_providers.*] 覆盖，
    // 否则 codex 启动报 "model_providers contains reserved built-in provider IDs"。
    const RESERVED_PROVIDER_IDS = new Set(['openai', 'ollama', 'lmstudio']);
    for (const [pid, prov] of Object.entries(settings.providers || {})) {
      if (RESERVED_PROVIDER_IDS.has(pid) || !prov || !prov.baseUrl) continue;
      const wa = prov.wireApi === 'chat' ? 'responses' : (prov.wireApi || 'responses');
      lines.push(`[model_providers.${pid}]`);
      lines.push(`name = ${JSON.stringify(prov.name || pid)}`);
      lines.push(`base_url = ${JSON.stringify(prov.baseUrl)}`);
      lines.push(`env_key = ${JSON.stringify(prov.envKey || (pid.toUpperCase() + '_API_KEY'))}`);
      lines.push(`wire_api = ${JSON.stringify(wa)}`);
      lines.push('');
    }
    // 角色 MCP：来自 MCP 注册表（global active + 本角色 active），独立于角色 schema
    for (const srv of mcp.activeServersForRole(role.id)) {
      const pid = `mcp_${role.id}_${srv.name}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
      lines.push(`[mcp_servers.${pid}]`);
      if (srv.type === 'http') {
        lines.push(`type = "streamable-http"`);
        lines.push(`url = ${JSON.stringify(expandVars(srv.url))}`);
        if (srv.headers && Object.keys(srv.headers).length) {
          lines.push(`[mcp_servers.${pid}.headers]`);
          for (const [k, v] of Object.entries(srv.headers)) lines.push(`${JSON.stringify(k)} = ${JSON.stringify(v)}`);
        }
      } else if (srv.type === 'sse') {
        lines.push(`type = "sse"`);
        lines.push(`url = ${JSON.stringify(expandVars(srv.url))}`);
        if (srv.headers && Object.keys(srv.headers).length) {
          lines.push(`[mcp_servers.${pid}.headers]`);
          for (const [k, v] of Object.entries(srv.headers)) lines.push(`${JSON.stringify(k)} = ${JSON.stringify(v)}`);
        }
      } else {
        // stdio（默认）
        lines.push(`command = ${JSON.stringify(resolveToolCommand(expandVars(srv.command)))}`);
        if (srv.args && srv.args.length) lines.push(`args = [${srv.args.map((a) => JSON.stringify(expandVars(a))).join(', ')}]`);
        if (srv.env && Object.keys(srv.env).length) {
          lines.push(`[mcp_servers.${pid}.env]`);
          for (const [k, v] of Object.entries(srv.env)) lines.push(`${JSON.stringify(k)} = ${JSON.stringify(expandVars(v))}`);
        }
      }
      lines.push('');
    }
    // 关掉引擎自带的「窗口预算提醒」（剩余 <6k token 时会打断模型让它写 notes 并换窗口，
    // 用户侧看到的就是"任务做一半停了"）；压缩统一由上面的 autocompact 阈值控制。
    // 注意：这是 [table]，必须放在所有顶层键之后。
    lines.push('[features.token_budget]');
    lines.push('enabled = false');
    lines.push('');
    // 信任工作目录，允许沙箱读写 work/<role>
    lines.push(`[projects.${platform.tomlPath(ROOT)}]`);
    lines.push('trust_level = "trusted"');
    // Windows 沙箱配置（仅 win32 生效；mac 上 sandboxConfigLines 返回空数组，配置不变）
    const winMode = (settings.global && settings.global.windowsSandbox) || 'elevated';
    const winLines = platform.sandboxConfigLines(process.platform, winMode);
    if (winLines.length) { lines.push(''); lines.push(...winLines); }
    // ⚠️ config.toml 里可能含 MCP 的 Authorization / env 密钥 → 必须 0600（默认 umask 会写成 0644）
    const cfg = path.join(home, 'config.toml');
    fs.writeFileSync(cfg, lines.join('\n'), { mode: 0o600 });
    try { fs.chmodSync(cfg, 0o600); } catch { /* 平台不支持时忽略 */ }
  }

  // 每轮刷新运行资产（全局 AGENTS.md + 激活技能），保证提示词/技能改动即时生效，
  // 不受进程缓存影响。幂等、开销小。全局记忆随 AGENTS 一并注入（记忆改动下一轮即生效）。
  _refreshRuntimeAssets(role, home) {
    const g = path.join(ROOT, 'roles', '_global', 'AGENTS-GLOBAL.md');
    const gMem = path.join(ROOT, 'roles', '_global', 'MEMORY.md');
    if (fs.existsSync(g)) {
      // 全局 AGENTS + 全局记忆（记忆以「事实区块」追加，注释明示非指令）
      fs.writeFileSync(path.join(home, 'AGENTS.md'), mergeMemory(fs.readFileSync(g, 'utf8'), gMem));
    }
    // 复制已激活技能（全局 + 本角色）到 home/skills，供 codex 原生 skill 扫描发现；
    // 未激活技能不复制 → 模型不可见、不可用
    const homeSkills = path.join(home, 'skills');
    try { fs.rmSync(homeSkills, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(homeSkills, { recursive: true });
    for (const s of skills.activeSkillsForRole(role.id)) {
      const srcDir = path.join(skills.SKILLS_DIR, s.id);
      try { if (fs.existsSync(srcDir)) fs.cpSync(srcDir, path.join(homeSkills, s.id), { recursive: true }); } catch {}
    }
  }

  async _spawnServer(role, providerId, modelId, sandbox, approval) {
    // 进程键 = 角色：一个 app-server 进程承载该角色全部会话/线程，
    // 模型/厂商/沙箱/审批/模式每轮由 turn/start 注入，不随进程变化。
    const key = role.id;
    if (this.procs.has(key)) return this.procs.get(key);
    const home = this._roleHome(role.id);
    return this._withHomeLock(home, () => {
      if (this.procs.has(key)) return this.procs.get(key); // 锁内二次检查
      // 资产刷新（AGENTS.md + home/skills 的 rm -rf 后重建）必须在同一把 home 锁里：
      // 否则同一角色的两个并发 createTurn 会互相删掉刚拷进去的技能目录，
      // 运行中的另一个会话可能正好扫到这个空窗期。
      this._refreshRuntimeAssets(role, home);
      this._writeConfig(role, providerId, modelId, sandbox, approval, home);
      clearXattr(home); // 容错：清 provenance 标记，避免 codex sqlite 初始化失败
      return this._bootProc(key, home, `${role.id}|${modelId}`);
    });
  }

  // 实际 spawn + 事件绑定（角色进程与系统进程共用，避免两处 spawn 逻辑分叉）
  _bootProc(key, home, label) {
    const proc = spawn(CODEX_BIN, ['app-server'], {
      env: { ...process.env, CODEX_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
      ...platform.spawnOptions(),   // Windows：隐藏控制台窗口（否则子进程闪黑框）
    });
    const st = { proc, nextId: 1, pending: new Map(), buffer: '', ready: false, key, lastUsed: Date.now() };
    this.procs.set(key, st);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => this._onStdout(st, d));
    proc.stderr.on('data', (d) => {
      process.stderr.write(`[codex:${label || key}] ` + d);
      // 环形缓冲最近 200 行：Windows「启动无输出」类问题必须靠 stderr 定位，诊断包要能带走
      this.recentStderr.push(String(d));
      if (this.recentStderr.length > 200) this.recentStderr.splice(0, this.recentStderr.length - 200);
    });
    // ⚠️ 必须挂 'error'：spawn 失败（EACCES/ENOENT-at-exec）或 stdin 写入已关闭的管道会发 error 事件，
    // 流上没有监听者时 Node 直接抛出 → 整个 Electron 主进程崩掉（所有会话一起死）。
    proc.on('error', (err) => {
      const msg = `codex 进程启动/运行失败：${(err && err.message) || err}`;
      process.stderr.write(`[codex:${label || key}] ${msg}\n`);
      for (const { reject } of st.pending.values()) reject(new Error(msg));
      st.pending.clear();
      if (this.procs.get(key) === st) this.procs.delete(key);
      this._failTurnsOnProc(st, msg);
    });
    if (proc.stdin) proc.stdin.on('error', (err) => {
      process.stderr.write(`[codex:${label || key}] stdin 写入失败：${(err && err.message) || err}\n`);
    });
    proc.on('exit', (code, signal) => {
      // ⚠️ 必须校验身份：killTree/invalidateProcs/reapIdleProcs 都是"先杀后清"，
      // 下一轮可能已经 spawn 了新进程并登记在同一个 key 上；旧进程的 exit 迟到时若无脑
      // delete(key)，会把**新进程**从表里删掉 → LRU/退出时杀不到它，还会再 spawn 一个 → 进程泄漏。
      if (this.procs.get(key) === st) this.procs.delete(key);
      // 进程退出时立即失败所有未决 RPC，不让调用方干等到超时
      for (const { reject } of st.pending.values()) reject(new Error('codex 进程已退出'));
      st.pending.clear();
      // 该进程上正在跑的 turn 必须**显式失败**：否则前端不会收到任何事件，
      // 界面永远停在「处理中」——用户侧表现就是「工作流莫名停止」，且无法再用停止键收尾。
      this._failTurnsOnProc(st,
        `codex 引擎进程已退出（${code === null || code === undefined ? '' : 'code ' + code}${signal ? ' / ' + signal : ''}），本轮已中止；下一次发送会自动重启引擎并接回同一线程。`);
    });
    return st;
  }

  /* ---------- 引擎级事件出口（不绑定 turn：沙箱状态、目录告警等） ---------- */
  onGlobal(fn) { this.globalListeners.add(fn); return () => this.globalListeners.delete(fn); }
  _emitGlobal(ev) {
    for (const fn of this.globalListeners) {
      try { fn(ev); } catch (e) { process.stderr.write('[engine] 全局事件处理失败: ' + (e && e.message) + '\n'); }
    }
  }

  /* ---------- Windows 沙箱状态机 ---------- */
  // 系统查询专用 CODEX_HOME：不承载会话、不写模型配置，仅供沙箱探针/自检复用
  _systemHome() {
    const home = path.join(CODEX_HOME, 'system');
    fs.mkdirSync(home, { recursive: true });
    const cfg = path.join(home, 'config.toml');
    if (!fs.existsSync(cfg)) {
      fs.writeFileSync(cfg, '# ROSE 系统查询 CODEX_HOME（沙箱探针/环境自检）：无会话、无模型配置\n');
    }
    return home;
  }

  async _systemProc() {
    const key = '__system__';
    if (this.procs.has(key)) return this.procs.get(key);
    const home = this._systemHome();
    return this._withHomeLock(home, () => {
      if (this.procs.has(key)) return this.procs.get(key);
      return this._bootProc(key, home, 'system');
    });
  }

  // 查询沙箱就绪状态（结果短缓存；出错不缓存，下次立即重试）
  async sandboxReadiness(opts = {}) {
    if (!platform.isWin(process.platform)) return { status: 'notApplicable', at: Date.now() };
    const ttl = opts.ttlMs === undefined ? 30000 : opts.ttlMs;
    if (!opts.force && this._sandboxCache && Date.now() - this._sandboxCache.at < ttl) return this._sandboxCache.value;
    try {
      const st = await this._systemProc();
      this._touch(st);
      await this._ensureReady(st);
      const r = await this._rpc(st, 'windowsSandbox/readiness', {}, 15000);
      const value = { status: (r && r.status) || 'unknown', raw: r || null, at: Date.now() };
      this._sandboxCache = { at: value.at, value };
      return value;
    } catch (e) {
      this._sandboxCache = null;
      return { status: 'error', error: (e && e.message) || String(e), at: Date.now() };
    }
  }

  // 触发沙箱初始化（elevated 会弹 UAC）；完成经 windowsSandbox/setupCompleted 通知异步回来
  async sandboxSetup(mode, cwd) {
    if (!platform.isWin(process.platform)) return { started: false, error: '仅 Windows 需要沙箱初始化' };
    if (!['elevated', 'unelevated'].includes(mode)) return { started: false, error: `非法沙箱模式：${mode}` };
    if (this.sandboxSetupState.running) return { started: false, error: '初始化已在进行中' };
    try {
      const st = await this._systemProc();
      this._touch(st);
      await this._ensureReady(st);
      const params = { mode };
      if (cwd) params.cwd = cwd;   // 只允许 cwd 出现在此处；沙箱用户/防火墙由 codex 自建
      const r = await this._rpc(st, 'windowsSandbox/setupStart', params, 30000);
      const started = !!(r && r.started);
      if (!started) {
        // 明确失败：绝不把 started:false 当成功。历史上这里静默返回，
        // 用户在 UI 点「初始化」毫无反应，只能靠猜（表现为「elevated 永远无效」）。
        const raw = (() => { try { return JSON.stringify(r); } catch { return String(r); } })();
        this.sandboxSetupState = { running: false, mode, startedAt: Date.now(), lastResult: null, lastStartRaw: raw };
        return { started: false, mode, raw, error: `codex 未启动沙箱初始化（windowsSandbox/setupStart 返回 ${raw}）` };
      }
      this.sandboxSetupState = { running: true, mode, startedAt: Date.now(), lastResult: null, lastStartRaw: null };
      this._sandboxCache = null;   // 下次 readiness 重新查询
      this._emitGlobal({ type: 'sandbox-setup-start', mode, started });
      return { started: true, mode };
    } catch (e) {
      return { started: false, mode, error: (e && e.message) || String(e) };
    }
  }

  /**
   * 把线程映射里使用 (providerId, fromModel) 的会话改到 toModel。
   * 改名的"同步"必须覆盖这里：映射记录每个会话当前用哪个模型，
   * 不更新的话，引擎侧记录的与会话实际将要注入的 model 会不一致。
   * @returns {number} 受影响的会话数
   */
  renameModelInThreads(providerId, fromModel, toModel) {
    let n = 0;
    for (const [sid, t] of this.threads) {
      if (t && t.providerId === providerId && t.modelId === fromModel) {
        this.threads.set(sid, { ...t, modelId: toModel });
        n++;
      }
    }
    if (n) this._persistThreads();
    return n;
  }

  // 诊断信息（诊断包用）：活跃进程、线程映射数、stderr 尾部
  diagInfo() {
    return {
      processKeys: [...this.procs.keys()],
      threadCount: this.threads.size,
      pendingRpc: [...this.procs.values()].reduce((n, st) => n + st.pending.size, 0),
      stderrTail: this.recentStderr.slice(-40),
    };
  }

  // 汇总给 UI 的沙箱状态
  sandboxState() {    return {
      platform: process.platform,
      supported: platform.isWin(process.platform),
      mode: (this._getSettings().global && this._getSettings().global.windowsSandbox) || 'elevated',
      readiness: this._sandboxCache ? this._sandboxCache.value : null,
      setup: this.sandboxSetupState,
    };
  }

  // 会话所属角色进程（审批/提问/中断应答用；线程身份=会话，与参数无关）
  _procFor(session) {
    return this.procs.get(session.role && session.role.id);
  }

  // 标记进程被使用（每次 turn 前刷新），供 LRU 淘汰参考
  _touch(st) { if (st) st.lastUsed = Date.now(); }

  /**
   * 显式失败某个进程上所有活跃 turn（进程退出 / 被 invalidate 杀掉 / 启动失败时共用）。
   * ⚠️ 必须**先**用它再清 map：否则 exit 事件迟到时 turnProc 已被清空，前端收不到任何事件，
   * 界面永远停在「处理中」，用户只能按停止键收尾。
   */
  _failTurnsOnProc(st, message) {
    for (const [threadId, owner] of [...this.turnProc.entries()]) {
      if (owner !== st) continue;
      this.turnProc.delete(threadId);
      this.turnIds.delete(threadId);
      const h = this.turnByThread.get(threadId);
      if (!h) continue;
      this.turnByThread.delete(threadId);
      try { h.emit({ type: 'error', message }); } catch { /* 前端已断开也不能影响其他 turn */ }
    }
  }

  // LRU 闲置回收：杀掉超过 idleMs 未被使用、且当前无未决 RPC 的 codex 进程。
  // 多用户/多会话场景防止常驻进程无限堆积占内存。
  reapIdleProcs(idleMs) {
    const cutoff = Date.now() - idleMs;
    let killed = 0;
    const busyProcs = new Set(this.turnProc.values());
    for (const [key, st] of this.procs) {
      if (busyProcs.has(st)) continue;   // 正在跑 turn：无论闲置多久都不回收（曾导致长任务被"静默掐断"）
      if (st.lastUsed < cutoff && st.pending.size === 0) {
        platform.killTree(st.proc);   // Windows 走 taskkill /T 整树回收，POSIX 等价于 kill()
        this.procs.delete(key);
        killed++;
      }
    }
    return killed;
  }

  async _ensureReady(st) {
    if (st.ready) return;
    // 同一角色的两个会话可能并发首发：没有 in-flight 去重就会发两次 initialize，
    // 第二次可能被引擎拒绝 → 其中一条会话的首轮以看不懂的 RPC 错误失败。
    if (!st.readyPromise) {
      st.readyPromise = this._rpc(st, 'initialize', {
        clientInfo: { name: 'ROSE', title: 'ROSE', version: '0.2.0' },
        capabilities: { experimentalApi: true }, // 开启实验 API：turn/start.collaborationMode（Plan 模式）
      }, 20000).then(() => { st.ready = true; }).catch((e) => { st.readyPromise = null; throw e; });
    }
    await st.readyPromise;
  }

  _onStdout(st, chunk) {
    st.buffer += chunk;
    let idx;
    while ((idx = st.buffer.indexOf('\n')) >= 0) {
      const line = st.buffer.slice(0, idx).trim();
      st.buffer = st.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this._handleMsg(st, msg);
    }
  }

  _handleMsg(st, msg) {
    // 1) RPC 响应：错误必须 reject，否则失败会被静默吞掉。
    //    ⚠️ 必须排除带 `method` 的服务端请求（审批/询问也用数字 id，撞车时会把真正要处理的
    //    请求当成"响应"吞掉 → 弹窗永不出现、工具调用挂死）。
    if (msg.id !== undefined && msg.method === undefined && st.pending.has(msg.id)) {
      const { resolve, reject } = st.pending.get(msg.id);
      st.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    const m = msg.method || '';
    const params = msg.params || {};

    // 2a) codex 'item/permissions/requestApproval'：能力/沙箱越权升级申请。
    // v0.20.2/3 曾误判其为"远程 MCP 出网的网络提权"并接入前端弹窗——经真机复现（v0.20.4），
    // 真正的远程 MCP 工具授权门是下方 'mcpServer/elicitation/request'，本请求并非该路径。
    // 为不留隐患：不对未知的能力升级做自动放行，也不抛误导性弹窗；统一以合法空授予
    // PermissionsRequestApprovalResponse { permissions:{} } 确定性应答（不越权、不挂起）。
    if (msg.id !== undefined && m === 'item/permissions/requestApproval') {
      process.stderr.write(
        `[codex] item/permissions/requestApproval（能力升级）→ 空授予拒绝，不自动放行（threadId=${params.threadId || '?'}）\n`);
      st.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { permissions: {} } }) + '\n');
      return;
    }

    // 2a-2) codex 0.152+ 远程 MCP 工具的授权门 'mcpServer/elicitation/request'：
    // 模型调用远程 MCP 工具（如麦麦 http MCP available-coupons）时，codex 以本请求征求是否
    // 允许该工具执行，线程置 waitingOnApproval。应答为 McpServerElicitationRequestResponse
    // { action:'accept'|'decline'|'cancel' }（非 {decision}、非权限授予对象）。
    // 零信任(approval=never)不触发此门；on-request 触发。若引擎不答 → 该工具调用永久挂起
    // （正是用户报的「远程 MCP 工具卡住」）。这里上浮前端授权弹窗，由用户允许/拒绝。
    if (msg.id !== undefined && m === 'mcpServer/elicitation/request') {
      const meta = params._meta || {};
      const isApproval = !!meta.codex_approval_kind; // 如 mcp_tool_call
      const toolName = (typeof params.message === 'string' && params.message.match(/"([^"]+)"/))?.[1]
        || (params.serverName || '');
      const turn = this.turnByThread.get(params.threadId || '') ||
        (this.turnByThread.size === 1 ? [...this.turnByThread.values()][0] : null);
      this.pendingElicitations.add(msg.id);
      if (turn) {
        turn.emit({
          type: 'approval-request', requestId: msg.id,
          kind: 'mcp-tool',
          level: isApproval ? 'escalate' : 'confirm',
          toolName,
          message: params.message || '',
          reason: isApproval ? (meta.tool_description || '') : '',
        });
      } else {
        // 无法定位归属 turn：cancel（不挂起、不越权）
        this.pendingElicitations.delete(msg.id);
        process.stderr.write(`[codex] MCP 授权请求无法路由（threadId=${params.threadId}），已 cancel\n`);
        st.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { action: 'cancel' } }) + '\n');
      }
      return;
    }

    // 2) server→client 请求：审批（v0.152: execCommandApproval / applyPatchApproval）
    if (msg.id !== undefined && /approval/i.test(m)) {
      const turn = this.turnByThread.get(params.threadId || '') ||
        (this.turnByThread.size === 1 ? [...this.turnByThread.values()][0] : null);
      if (turn) {
        const requestId = msg.id; // 直接用请求 id 应答
        turn.emit({
          type: 'approval-request', requestId,
          kind: m.includes('Patch') ? 'patch' : 'exec',
          command: params.command || params.reason || '',
        });
      } else {
        // 无法定位归属 turn 且存在并发歧义：丢弃并应答拒绝，避免审批串台
        process.stderr.write(`[codex] 审批请求无法路由（threadId=${params.threadId}），已拒绝\n`);
        st.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { decision: 'denied' } }) + '\n');
      }
      return;
    }

    // 2b) server→client 请求：模型主动向用户提问（带选项的选择框）
    if (msg.id !== undefined && m === 'item/tool/requestUserInput') {
      const turn = this.turnByThread.get(params.threadId || '') ||
        (this.turnByThread.size === 1 ? [...this.turnByThread.values()][0] : null);
      if (turn) {
        turn.emit({ type: 'ask', requestId: msg.id, questions: params.questions || [] });
      } else {
        process.stderr.write(`[codex] 询问请求无法路由（threadId=${params.threadId}），已空应答\n`);
        st.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { answers: {} } }) + '\n');
      }
      return;
    }

    // 3) 通知（v0.152 协议：method 风格 + 扁平 params）
    if (m === 'item/agentMessage/delta') {
      // 助手文本的真正流式通道（逐段推送）；item/completed 的累计文本只作为兜底
      const turn = this.turnByThread.get(params.threadId);
      if (turn && typeof params.delta === 'string' && params.delta) {
        turn.__deltaSeen = true;
        turn.emit({ type: 'text-delta', delta: params.delta });
      }
      return;
    }
    if (m === 'turn/started') {
      // 兜底：turnId 也可能只在这条通知里出现
      if (params.threadId) this._rememberTurnId(params.threadId, params);
      return;
    }
    if (m === 'turn/plan/updated') {
      // 结构化计划（update_plan 工具）：{explanation, plan:[{step,status: pending|inProgress|completed}]}
      const turn = this.turnByThread.get(params.threadId);
      if (turn) turn.emit({ type: 'plan', plan: params.plan || [], explanation: params.explanation || '' });
      return;
    }
    if (m === 'item/plan/delta') {
      // Plan 模式交付的 <proposed_plan> 正文走这条独立通道（与 update_plan 的 turn/plan/updated 不同）。
      // 不接的后果：计划正文整段丢失，正文只剩「以下是实施计划。」后半句空白 —— 表现为「输出被截断」。
      const turn = this.turnByThread.get(params.threadId);
      const delta = typeof params.delta === 'string' ? params.delta
        : (typeof params.text === 'string' ? params.text : '');
      if (turn && delta) {
        if (!turn.__planSeen) {
          turn.__planSeen = true;
          turn.emit({ type: 'plan-delivered' });   // 计划开始交付：供上层判断「Plan 已出稿」
        }
        turn.emit({ type: 'text-delta', delta });
      }
      return;
    }
    if (m === 'item/commandExecution/outputDelta') {
      // 工具输出流式：追加到对应运行中的工具卡片
      const turn = this.turnByThread.get(params.threadId);
      if (turn) turn.emit({ type: 'tool-output-delta', toolId: params.itemId, delta: params.delta || '' });
      return;
    }
    if (m === 'item/reasoning/textDelta') {
      // 思考过程文本流
      const turn = this.turnByThread.get(params.threadId);
      if (turn) turn.emit({ type: 'reasoning-delta', itemId: params.itemId, delta: params.delta || '' });
      return;
    }
    if (m === 'thread/tokenUsage/updated') {
      // 记录最近一次 turn 的 token 用量，turn 完成时随 usage 事件上报
      const turn = this.turnByThread.get(params.threadId);
      if (turn && params.tokenUsage) {
        const tu = params.tokenUsage;
        if (tu.last) turn.__usage = tu.last;
        const win = tu.model_context_window ?? tu.modelContextWindow;
        if (typeof win === 'number' && win > 0) turn.__contextWindow = win;
        // 实时上下文占用：每轮内部会多次上报，节流后上浮，供界面"边跑边看"（而不是等回合结束）
        const used = (tu.last && (tu.last.inputTokens || tu.last.totalTokens)) || 0;
        const now = Date.now();
        if (used > 0 && now - (turn.__ctxAt || 0) > 800) {
          turn.__ctxAt = now;
          turn.emit({ type: 'context-usage', used, window: turn.__contextWindow || null });
        }
      }
      return;
    }
    if (m === 'item/started' || m === 'item/updated' || m === 'item/completed') {
      const threadId = params.threadId;
      const item = params.item || {};
      const turn = this.turnByThread.get(threadId);
      if (!turn) {
        // 没有活跃回合时的**会话级** item：典型是空闲会话的手动压缩
        // （thread/compact/start → ContextCompaction 的 started/completed）。
        // 原先这里直接 return → 事件被丢 → 前端蒙版等不到 compact-end，只能等超时。
        if (item.type === 'contextCompaction' || item.type === 'ContextCompaction') {
          this._emitGlobal({ type: 'session-item', threadId, phase: m, item });
        }
        return;
      }
      this._handleItem(turn, m, item);
      return;
    }
    if (m === 'error') {
      const e = params.error || {};
      // 优先按 threadId 定位；进程级 error（无 threadId）仅在恰有一个活跃 turn 时才转发，避免串台
      let turn = this.turnByThread.get(params.threadId);
      if (!turn && this.turnByThread.size === 1) {
        turn = [...this.turnByThread.values()][0];
      }
      if (turn) turn.emit({ type: 'error', message: e.message || 'codex error' });
      else process.stderr.write(`[codex] 错误事件无法路由（threadId=${params.threadId}）：${e.message || 'unknown'}\n`);
      return;
    }
    if (m === 'turn/completed') {
      const turn = this.turnByThread.get(params.threadId);
      if (!turn) return;
      this.turnByThread.delete(params.threadId);
      this.turnProc.delete(params.threadId);
      this.turnIds.delete(params.threadId);
      const status = params.turn && params.turn.status;
      if (status === 'failed') {
        turn.emit({ type: 'error', message: (params.turn && params.turn.error && params.turn.error.message) || 'turn failed' });
      } else {
        if (turn.__usage) turn.emit({ type: 'usage', usage: turn.__usage, contextWindow: turn.__contextWindow || null });
        turn.emit({ type: 'turn-complete' });
      }
      return;
    }
    // 3a-1) 配置告警：codex 解析 config.toml 失败时会**回落默认值**并只发一条通知——
    // 不显式上浮的话，用户看到的是"对话跑不通/模型不存在"，而真因在配置里。
    if (m === 'configWarning') {
      const summary = (params && params.summary) || '配置有误';
      const details = (params && params.details) || '';
      process.stderr.write(`[codex] configWarning: ${summary} ${details}\n`);
      this._emitGlobal({ type: 'config-warning', summary, details, path: (params && params.path) || null });
      return;
    }

    // 3b) Windows 沙箱：初始化完成通知 / 目录全局可写告警（引擎级事件，不绑定 turn）
    if (m === 'windowsSandbox/setupCompleted') {
      const success = !!params.success;
      this.sandboxSetupState = {
        running: false,
        mode: params.mode || this.sandboxSetupState.mode,
        startedAt: this.sandboxSetupState.startedAt,
        lastResult: { success, error: params.error || null, at: Date.now() },
      };
      this._sandboxCache = null;   // 状态已变，强制下次重新查询
      this._emitGlobal({ type: 'sandbox-setup-completed', mode: params.mode || null, success, error: params.error || null });
      return;
    }
    if (m === 'windows/worldWritableWarning') {
      this._emitGlobal({ type: 'world-writable-warning', detail: params });
      return;
    }
    // thread/started、thread/status/changed、warning、token-count 等忽略
  }

  // 从 turn/start 的返回或 turn/started 通知里记下 turnId（两种线上形态都兼容）
  _rememberTurnId(threadId, resOrNotif) {
    const id = (resOrNotif && (resOrNotif.turnId || (resOrNotif.turn && resOrNotif.turn.id))) || null;
    if (id) this.turnIds.set(threadId, id);
    return id;
  }

  _handleItem(turn, phase, item) {
    const type = item.type;
    const textOf = (it) => (it.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text).join('');
    if (type === 'agentMessage') {
      // delta 通道已流式输出过 → completed 的累计文本不再 diff，避免整段重复
      if (turn.__deltaSeen) return;
      // item/updated 带累计文本，diff 出增量
      const full = textOf(item) || item.text || '';
      item.__seen = item.__seen || '';
      turn.__agentText = turn.__agentText || new Map();
      const last = turn.__agentText.get(item.id) || '';
      if (full.length > last.length) {
        turn.emit({ type: 'text-delta', delta: full.slice(last.length) });
        turn.__agentText.set(item.id, full);
      }
      return;
    }
    if (type === 'commandExecution') {
      const id = String(item.id || 'exec');
      const cmd = Array.isArray(item.command) ? item.command.join(' ') : (item.command || '');
      if (phase === 'item/started') turn.emit({ type: 'tool-start', toolId: id, name: 'shell', args: cmd });
      else if (phase === 'item/completed') {
        const out = item.aggregatedOutput || item.output || '';
        turn.emit({ type: 'tool-end', toolId: id, ok: (item.exit_code ?? item.exitCode ?? 0) === 0, output: String(out).slice(0, 4000) });
      }
      return;
    }
    if (type === 'mcpToolCall') {
      const id = String(item.id || 'mcp');
      if (phase === 'item/started') turn.emit({ type: 'tool-start', toolId: id, name: 'mcp:' + (item.tool || 'call'), args: JSON.stringify(item.arguments || {}) });
      else if (phase === 'item/completed') turn.emit({ type: 'tool-end', toolId: id, ok: true, output: String(item.output || '').slice(0, 4000) });
      return;
    }
    if (type === 'fileChange') {
      const id = String(item.id || 'patch');
      if (phase === 'item/started') turn.emit({ type: 'tool-start', toolId: id, name: 'apply_patch', args: (item.changes || []).map((c) => c.path).join(', ') });
      else if (phase === 'item/completed') turn.emit({ type: 'tool-end', toolId: id, ok: true, output: '文件已修改' });
      return;
    }
    if (type === 'contextCompaction' || type === 'ContextCompaction') {
      // 手动/自动压缩在事件流里表现为 ContextCompaction item（Codex 无独立完成通知，这是唯一可靠信号）
      if (phase === 'item/started') turn.emit({ type: 'compact-start', auto: item.trigger === 'auto' || item.auto === true });
      else if (phase === 'item/completed') turn.emit({ type: 'compact-end', ok: true });
      return;
    }
    if (type === 'plan') {
      // 计划项（Plan 模式的 <proposed_plan>）：delta 通道已覆盖正文，仅在完全没收到 delta 时兜底
      if (phase === 'item/completed' && !turn.__planSeen) {
        const text = textOf(item) || (typeof item.text === 'string' ? item.text : '');
        if (text) {
          turn.__planSeen = true;
          turn.emit({ type: 'plan-delivered' });
          turn.emit({ type: 'text-delta', delta: text });
        }
      }
      return;
    }
    // userMessage / reasoning / webSearch 等暂不渲染
  }

  _rpc(st, method, params, timeoutMs) {
    const id = st.nextId++;
    return new Promise((resolve, reject) => {
      // 超时定时器必须随响应一起清掉，否则每个 RPC 都留下一个最长 60s 的活定时器
      // （并一直持有 st 引用，invalidate 之后还留着死对象）
      const timer = setTimeout(() => {
        if (st.pending.has(id)) { st.pending.delete(id); reject(new Error('rpc timeout: ' + method)); }
      }, timeoutMs || 60000);
      const wrap = (fn) => (v) => { clearTimeout(timer); fn(v); };
      st.pending.set(id, { resolve: wrap(resolve), reject: wrap(reject) });
      try {
        st.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (e) {
        clearTimeout(timer);
        st.pending.delete(id);
        reject(new Error('写入引擎失败：' + ((e && e.message) || e)));
      }
    });
  }

  async createTurn(session, userText, handlers, images, skillRefs) {
    const role = session.role;
    const providerId = session.providerId;
    const modelId = session.modelId;
    // 守卫：会话指定的 provider 必须真的在配置里。否则 codex 只会抛出
    // `failed to load configuration: Model provider \`xxx\` not found`（对用户毫无指向性）。
    // 这里提前拦住并说清怎么办；顺带把"配置是应用启动后新增的"这种情况也解释掉。
    const liveProviders = this._getSettings().providers || {};
    const BUILTIN = new Set(['openai', 'ollama', 'lmstudio']);
    if (providerId && !BUILTIN.has(providerId) && !liveProviders[providerId]) {
      throw new Error(`模型供应商「${providerId}」不在当前配置中。请到「设置 → 模型配置」确认该 Provider 已保存`
        + `（已保存的 Provider：${Object.keys(liveProviders).join('、') || '（无）'}），然后重新选择模型再发送。`);
    }
    const policy = policyFor(session, this._getSettings());
    // 回合前确认沙箱状态（Windows）：readiness 非 ready 时上浮告警，让 UI 显式提示，
    // 绝不静默失去隔离。结果有 30s 缓存，不阻塞本轮（fire-and-forget）。
    if (platform.isWin(process.platform)) {
      this.sandboxReadiness().then((r) => {
        if (r.status !== 'ready') {
          this._emitGlobal({
            type: 'sandbox-readiness', ...r,
            mode: (this._getSettings().global && this._getSettings().global.windowsSandbox) || 'elevated',
            from: 'turn',
          });
        }
      }).catch(() => { /* 探测失败不阻断回合，由 UI 横幅兜底 */ });
    }
    // 工作目录：会话自带（新建会话时用户指定，创建后不可改）；历史会话无该字段时回退到旧的 work/<role>
    const cwd = (session.workspace && path.isAbsolute(session.workspace))
      ? session.workspace
      : path.join(ROOT, 'work', role.id);
    fs.mkdirSync(cwd, { recursive: true });
    // 角色人格（Soul）已作为 developer_instructions 注入角色进程 config（见 _writeConfig），
    // 不再向 work/<role> 投射 AGENTS.md；work/ 只承担 agent 工作目录与附件职责。

    // 运行资产（AGENTS/技能）刷新到角色级 CODEX_HOME（全参数组合共享）
    const home = this._roleHome(role.id);
    this._refreshRuntimeAssets(role, home);

    // 角色进程：模型/厂商/沙箱/审批/模式均每轮在 turn/start 注入，进程不随参数变化
    const st = await this._spawnServer(role, providerId, modelId, policy.sandbox, policy.approval);
    this._touch(st); // LRU 记账：本会话此刻在用它
    await this._ensureReady(st);

    // —— 线程身份 = 会话：一个会话一个线程，贯穿生命周期 ——
    // codex 的 provider 是 thread 级：官方 schema 中 TurnStartParams 无 modelProvider 字段，turn/start 无法切换 provider。
    // 换 provider 用 thread/fork 从旧线程分叉（原生保留历史上下文），并带新 modelProvider/model；
    // 同 provider 换 model 则无需 fork（turn/start 的 model 每轮生效）。
    let t = this.threads.get(session.id);
    if (t && t.providerId && t.providerId !== providerId) {
      try {
        const forkParams = { threadId: t.threadId, model: String(modelId || '') };
        if (providerId && providerId !== 'openai') forkParams.modelProvider = providerId;
        const forked = await this._rpc(st, 'thread/fork', forkParams, 30000);
        t = { roleId: role.id, threadId: forked.thread.id, cwd, providerId, modelId };
        this.threads.set(session.id, t);
        this._persistThreads();
      } catch {
        t = null; // fork 失败（旧线程丢失等）→ 退化为下方 thread/start 新建空线程
        this.threads.delete(session.id);
      }
    } else if (t) {
      try {
        await this._rpc(st, 'thread/resume', { threadId: t.threadId }, 20000);
      } catch {
        t = null; // 线程已丢，走下方重建
      }
    }
    if (!t) {
      const startParams = { cwd, model: String(modelId || '') };
      if (providerId && providerId !== 'openai') startParams.modelProvider = providerId;
      const thr = await this._rpc(st, 'thread/start', startParams);
      t = { roleId: role.id, threadId: thr.thread.id, cwd, providerId, modelId };
      this.threads.set(session.id, t);
      this._persistThreads();
    }

    const turn = new TurnHandle(handlers);
    this.turnByThread.set(t.threadId, turn);
    this.turnProc.set(t.threadId, st);   // 绑定承载进程：LRU 不得回收、进程退出要失败本轮

    // input：用户文本（含显式技能 $name 标记）→ 内联图片 → 显式技能引用
    const refs = (Array.isArray(skillRefs) ? skillRefs : []).filter((r) => r && r.name && r.path);
    let textWithSkills = userText;
    if (refs.length) textWithSkills = refs.map((r) => '$' + r.name).join(' ') + ' ' + textWithSkills;
    const input = [{ type: 'text', text: textWithSkills }];
    if (Array.isArray(images)) for (const img of images) {
      if (img && img.type === 'image' && img.url) input.push({ type: 'image', url: img.url });
    }
    for (const r of refs) input.push({ type: 'skill', name: r.name, path: r.path });

    const sandboxVariant = { 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite', 'danger-full-access': 'dangerFullAccess' };
    const turnParams = {
      threadId: t.threadId,
      input,
      // —— 每轮参数注入（与线程身份无关）：模型 / 厂商 / 沙箱 / 审批 ——
      model: String(modelId || ''),
      approvalPolicy: policy.approval,
      sandboxPolicy: { type: sandboxVariant[policy.sandbox] || 'workspaceWrite' },
    };
    if (providerId !== 'openai') turnParams.modelProvider = providerId;
    if (session.planMode) {
      // 注意: TurnStartParams 为 camelCase 线上格式，内层 Settings 为 snake_case
      turnParams.collaborationMode = {
        mode: 'plan',
        settings: {
          model: String(modelId || ''),
          reasoning_effort: null,
          developer_instructions: '凡是需要用户拍板的决策点，必须调用 request_user_input 工具，以选择题形式（每个选项附一句话说明）向用户征求决定；不要只在纯文本里罗列问题等待回复。',
        },
      };
    }

    try {
      const started = await this._rpc(st, 'turn/start', turnParams);
      // ⚠️ turn/start 返回的是 { turn: { id } }（不是 { turnId }）——曾按 turnId 取值导致
      // turnIds 永远为空，插话（turn/steer 需要 expectedTurnId）必然报"没有正在运行的任务"。
      this._rememberTurnId(t.threadId, started);
    } catch (e1) {
      const msg = (e1 && e1.message) || 'turn failed';
      // 线程在库中丢失（sqlite 被清 / 线程被外部删除）→ 新建空线程重试一次
      if (/thread/i.test(msg)) {
        try {
          const thr = await this._rpc(st, 'thread/start', { cwd });
          t = { roleId: role.id, threadId: thr.thread.id, cwd };
          this.threads.set(session.id, t);
          this._persistThreads();
          this.turnByThread.set(t.threadId, turn);
          this.turnProc.set(t.threadId, st);
          const started2 = await this._rpc(st, 'turn/start', { ...turnParams, threadId: t.threadId });
          this._rememberTurnId(t.threadId, started2);
        } catch (e2) {
          this.turnByThread.delete(t.threadId);
          this.turnProc.delete(t.threadId);
          turn.emit({ type: 'error', message: (e2 && e2.message) || msg });
        }
      } else {
        this.turnByThread.delete(t.threadId);
        this.turnProc.delete(t.threadId);
        turn.emit({ type: 'error', message: msg });
      }
    }
    return turn;
  }

  async approve(session, requestId, ok) {
    const st = this._procFor(session); // 按会话当前参数定位进程（参数注入，与线程无关）
    if (!st) return false;
    // 审批是对 server→client 请求的直接应答（同 id）。
    // 远程 MCP 工具授权门（mcpServer/elicitation/request）：应答 McpServerElicitationRequestResponse
    // { action:'accept'|'decline'|'cancel' }。允许→accept、拒绝→decline。
    if (this.pendingElicitations.has(requestId)) {
      this.pendingElicitations.delete(requestId);
      st.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, result: { action: ok ? 'accept' : 'decline' } }) + '\n');
      return true;
    }
    // 常规执行/写入审批：codex 0.152 决策枚举 accept/acceptForSession/…/decline/cancel，
    // 不是旧协议的 accepted/denied —— 答错会整包拒绝（approval request failed）。
    st.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, result: { decision: ok ? 'accept' : 'decline' } }) + '\n');
    return true;
  }

  // 应答模型的询问选择框（item/tool/requestUserInput）
  // answers: { [questionId]: [选中的 option label 或自由输入] }
  respondAsk(session, requestId, answers) {
    const st = this._procFor(session);
    if (!st) return false;
    st.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, result: { answers } }) + '\n');
    return true;
  }

  // 插话（turn/steer）：把一条消息直接送进正在跑的回合，不打断当前任务。
  // 线上参数（0.152.1 实测）：{ threadId, expectedTurnId, input:[{type:'text',text}] }；
  // 没有活跃回合时引擎会明确报 "no active turn to steer"。
  async steer(session, text) {
    const t = this.threads.get(session.id);
    const st = this._procFor(session);
    if (!t || !st) return { error: '会话尚未开始（先发一条消息再插话）' };
    const expectedTurnId = this.turnIds.get(t.threadId);
    if (!expectedTurnId || !this.turnByThread.has(t.threadId)) return { error: '当前没有正在执行的任务，无法插话' };
    try {
      await this._rpc(st, 'turn/steer', {
        threadId: t.threadId,
        expectedTurnId,
        input: [{ type: 'text', text: String(text || '') }],
      }, 30000);
      return { ok: true };
    } catch (e) {
      return { error: (e && e.message) || 'steer failed' };
    }
  }

  // 手动压缩上下文（thread/compact/start）。
  // 实测（0.152.1，app-server 探针）：① 线程未在本进程 resume 时引擎直接报 `thread not found`；
  // ② resume 之后该调用返回 {}，但**空闲线程上不会立刻产生压缩记录**——它是"请求在下一轮开始时压缩"，
  //    真正的压缩发生在回合内（历史记录里每次 compacted 都出现在回合中/回合边界）。
  // 因此这里如实按"请求"语义返回，界面不得假装已完成。
  async compact(session) {
    const t = this.threads.get(session.id);
    if (!t) return { error: '该会话还没有引擎线程（先发一条消息再压缩）' };
    if (this.turnByThread.has(t.threadId)) return { error: '有任务进行中，请先停止再压缩上下文' };
    try {
      // 进程可能被 LRU 回收或在应用重启后尚未拉起：按会话当前参数重新 spawn（与发消息同一条路径）
      let st = this._procFor(session);
      if (!st) {
        const policy = policyFor(session, this._getSettings());
        await this._refreshRuntimeAssets(session.role, this._roleHome(session.role.id));
        st = await this._spawnServer(session.role, session.providerId, session.modelId, policy.sandbox, policy.approval);
      }
      // 关键：先 resume —— 新进程里线程尚未加载，直接 compact 会被引擎拒绝（thread not found）
      await this._rpc(st, 'thread/resume', { threadId: t.threadId }, 30000);
      const raw = await this._rpc(st, 'thread/compact/start', { threadId: t.threadId }, 60000);
      return { ok: true, requested: true, raw: raw || null };
    } catch (e) {
      return { error: (e && e.message) || 'compact failed' };
    }
  }

  async interrupt(session) {
    const t = this.threads.get(session.id);
    const st = this._procFor(session);
    if (!t || !st) return false;
    // 发 turn/interrupt 优雅停止，但不等它 60s：race 3s，随后立即取消本会话 turn handler
    await Promise.race([
      this._rpc(st, 'turn/interrupt', { threadId: t.threadId }).catch(() => {}),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    // 关键：让该 turn 的 handler 失效，阻止 codex 残留输出继续上屏/落盘
    const h = this.turnByThread.get(t.threadId);
    if (h) h.cancel();
    this.turnByThread.delete(t.threadId);
    this.turnProc.delete(t.threadId);
    this.turnIds.delete(t.threadId);
    // 线程身份=会话：中断不丢弃线程映射，下一轮仍在同一线程续跑（上下文不丢）
    return true;
  }

  // 会话删除联动：移除映射 + 清理角色线程库中该会话的线程（thread + rollout，避免残留/堆积）。
  // 会话删除联动：移除映射 + 用 codex RPC thread/delete 清理该会话线程（sqlite 记录 + rollout 原子删除）。
  // 注意：不能单独删 rollout 文件——codex sqlite 记录 rollout 绝对路径，只删文件而 sqlite 记录还在 → stale。
  // 统一走 RPC 保证 sqlite 与文件一致；RPC 失败残留的孤儿由启动时 sweepOrphanThreads 兜底（也是 RPC 删）。
  dropSession(sessionId) {
    const t = this.threads.get(sessionId);
    this.threads.delete(sessionId);
    if (t) {
      this.turnByThread.delete(t.threadId);
      this._deleteThreadBestEffort(t.roleId, t.threadId);
    }
    this._persistThreads();
  }

  // 仅移除映射（角色整目录删除时用：线程库随后随 rm 整个角色 home 一并清掉）
  forgetThread(sessionId) {
    const t = this.threads.get(sessionId);
    this.threads.delete(sessionId);
    if (t) this.turnByThread.delete(t.threadId);
    this._persistThreads();
  }

  // 删除线程的兜底参数组合（进程可能已被 LRU 回收，需按需重 spawn）
  _defaultCombo() {
    const g = this._getSettings().global || {};
    const em = g.enabledModels || [];
    if (em.length) return { providerId: em[0].providerId, modelId: em[0].modelId };
    const pid = Object.keys(this._getSettings().providers || {})[0] || 'openai';
    return { providerId: pid, modelId: '' };
  }

  // 尽力而为地删除线程：RPC thread/delete（codex 删 sqlite 记录 + rollout，二者一致）。失败仅告警，
  // 不单独删 rollout 文件（否则 sqlite 记录残留 → stale）；残留孤儿由启动时 sweepOrphanThreads 再清。
  async _deleteThreadBestEffort(roleId, threadId) {
    try {
      const { providerId, modelId } = this._defaultCombo();
      const st = await this._spawnServer({ id: roleId }, providerId, modelId, 'workspace-write', 'on-request');
      this._touch(st);
      await this._ensureReady(st);
      await this._rpc(st, 'thread/delete', { threadId }, 15000);
    } catch (e) {
      process.stderr.write(`[engine] 线程 RPC 删除失败（${threadId}）：${(e && e.message) || e}\n`);
    }
  }

  // 启动时孤儿线程清理（兜底）：删除线程库中「不在活跃线程映射里」的孤儿线程。
  // 只用 codex RPC thread/delete（原子删 sqlite 记录 + rollout，二者一致）——绝不单独删 rollout 文件，
  // 否则 sqlite 记录残留 → stale rollout。RPC 失败（如进程无法 spawn）则保留，下次启动再试。
  async sweepOrphanThreads() {
    const runsDir = path.join(CODEX_HOME, 'runs');
    if (!fs.existsSync(runsDir)) return 0;
    const active = new Set([...this.threads.values()].map((t) => t.threadId));
    const orphansByRole = new Map();
    for (const role of fs.readdirSync(runsDir)) {
      const sessionsDir = path.join(runsDir, role, 'sessions');
      if (!fs.existsSync(sessionsDir)) continue;
      const stack = [sessionsDir];
      while (stack.length) {
        const dir = stack.pop();
        let entries; try { entries = fs.readdirSync(dir); } catch { continue; }
        for (const f of entries) {
          const p = path.join(dir, f);
          let st; try { st = fs.statSync(p); } catch { continue; }
          if (st.isDirectory()) { stack.push(p); continue; }
          if (!f.endsWith('.jsonl')) continue;
          const m = f.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
          if (!m || active.has(m[1])) continue;
          if (!orphansByRole.has(role)) orphansByRole.set(role, []);
          orphansByRole.get(role).push(m[1]);
        }
      }
    }
    if (!orphansByRole.size) return 0;
    let cleaned = 0;
    for (const [role, tids] of orphansByRole) {
      try {
        const { providerId, modelId } = this._defaultCombo();
        const st = await this._spawnServer({ id: role }, providerId, modelId, 'workspace-write', 'on-request');
        this._touch(st);
        await this._ensureReady(st);
        for (const tid of tids) {
          try { await this._rpc(st, 'thread/delete', { threadId: tid }, 15000); cleaned++; }
          catch { process.stderr.write(`[engine] 孤儿线程删除失败（${role}/${tid}），下次启动再试\n`); }
        }
      } catch {}
    }
    console.log(`[engine] 启动清理孤儿线程 ${cleaned} 个（${[...orphansByRole.keys()].join('/')}）`);
    return cleaned;
  }

  // 使全部缓存的 codex 进程失效（MCP 注册表变更后调用，下个 turn 重新 spawn 以加载新 config.toml）
  invalidateProcs(reason) {
    const why = reason || '引擎配置已变更（设置/角色/MCP 有更新），进程已重启';
    for (const st of this.procs.values()) {
      // 先让正在跑的 turn 显式失败（否则前端停在「处理中」，见 _failTurnsOnProc）
      this._failTurnsOnProc(st, `${why}；本轮已中止，下一次发送会自动重启引擎并接回同一线程。`);
      platform.killTree(st.proc);
    }
    this.procs.clear();
    // threads 映射保留：线程身份=会话，线程库在角色 home 的 sqlite 里，
    // 进程重启/参数变化均不影响线程续用 → MCP 变更也不会导致会话失忆
    this.turnByThread.clear();
    this.turnProc.clear();
    this.turnIds.clear();
    this.turnIds.clear();
  }

  // 优雅退出：关闭全部 codex app-server 子进程，避免网关退出后遗留孤儿进程
  async shutdown() {
    const procs = [...this.procs.values()];
    this.procs.clear();
    this.threads.clear();
    this.turnByThread.clear();
    this.turnProc.clear();
    await Promise.allSettled(procs.map(async (st) => {
      try {
        if (st.proc.exitCode === null) {
          try { st.proc.stdin.end(); } catch {}
          platform.killTree(st.proc);   // 整树回收：不留 codex 派生的 shell/工具孤儿
        }
      } catch { /* 已退出则忽略 */ }
    }));
  }
}

/* ---------------- 公共 ---------------- */

class TurnHandle {
  constructor(handlers) { this.handlers = handlers || {}; this.done = false; }
  emit(ev) {
    if (this.done && ev.type !== 'turn-complete') return;
    const fn = this.handlers[ev.type] || this.handlers['*'];
    if (fn) fn(ev);
    if (ev.type === 'turn-complete' || ev.type === 'error') this.done = true;
  }
  // 中断后调用：置位 done，使该 turn 后续任何事件（delta/tool/approval）都不再上屏/落盘
  cancel() { this.done = true; }
}

function createEngine(cfg) {
  const codex = new CodexEngine(cfg);
  if (!codex.available) {
    throw new Error(`未找到 codex 二进制（vendor/${CODEX_BIN_NAME}）。请先放置二进制后重启。`);
  }
  // 仅真实 codex 引擎；未配 API key 时由 codex harness 在上层返回清晰错误，
  // 前端引导到「设置 → API Key」补全后重启生效。
  console.log('[engine] codex harness 就绪（vendor codex ' + (process.env.CODEX_VERSION || '0.152.x') + '）');
  return codex;
}

module.exports = { createEngine, CodexEngine, TurnHandle, CODEX_BIN, CODEX_HOME, resolveToolCommand, expandVars, TOOLS_DIR, resolveContextWindow, familyWindow, FAMILY_CONTEXT_WINDOWS, contextBudget, ENGINE_CATALOG, engineCatalogEntry };
