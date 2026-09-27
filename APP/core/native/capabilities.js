'use strict';
/**
 * codex 原生能力登记表（B 阶段）· 纯常量 + 纯函数，不读盘、不起进程、无副作用。
 *
 * ⚠️ 本文件每一条 supported/reason 都必须对应 design/native-probes.md 里的真机实测证据
 *    （引擎 codex-cli 0.152.1）。改这里之前先重跑探针，别凭印象改。
 *
 * 用途：
 *  1) 引擎 `_configLines` 生成 `[features]` 片段；
 *  2) 服务层 / UI 通过 `nativeSupport()` 拿到"能不能用 + 为什么不能用"的可读降级原因
 *     （产品铁律：不生效必须留证据并降级，绝不静默失效）。
 *
 * 说明：**hooks 已全盘删除**（用户裁定）——引擎把用户 hooks 判 `trustStatus=untrusted` 且不执行、
 * 又没有信任 RPC，保留只会是"配置即承诺"的假能力；相关白名单/配置片段/事件映射一并移除。
 */

const ENGINE_VERSION = '0.152.1';

function applyPatchStreamingEnabled(settings) {
  const g = (settings && settings.global) || {};
  const native = (g.native && typeof g.native === 'object') ? g.native : {};
  const v = g.applyPatchStreaming !== undefined ? g.applyPatchStreaming : native.applyPatchStreaming;
  return v !== false;   // 默认开（探针：低风险、通知存在）
}

/**
 * `[features]` 段要写的键（顶层表内，调用方负责顺序：本表必须写在所有顶层键之后）。
 * 返回 { lines, notes }，notes 为可读说明（进诊断/降级提示）。
 */
function featureLines(settings) {
  const g = (settings && settings.global) || {};
  const lines = ['current_time_reminder = true'];   // 已接：clock::curr_time
  const notes = [];
  if (g.multiAgentV2 === true) {
    lines.push('multi_agent_v2 = true');            // 强制 v2（collaboration 命名空间）
    notes.push('multi_agent_v2=true → 子代理工具命名空间为 collaboration（v2）');
  }
  if (applyPatchStreamingEnabled(settings)) lines.push('apply_patch_streaming_events = true');
  return { lines, notes };
}

/** rollout_budget：一律不支持（0.152.1 缺陷），返回可读原因；绝不生成配置。 */
function rolloutBudgetDecision(settings) {
  const g = (settings && settings.global) || {};
  const requested = Number(g.rolloutTokenLimit);
  if (!Number.isFinite(requested) || requested <= 0) return { requested: null, supported: false, write: false, reason: null };
  return {
    requested: Math.round(requested),
    supported: false,
    write: false,
    reason: 'codex 0.152.1 无法启用 rollout_budget：启用需 reminder_at_remaining_tokens，'
      + '而该键一旦写入会令整份 config.toml 解析失败（回落默认=厂商/模型/人格全失效）。'
      + '已忽略该设置，未写入任何 rollout_budget 配置。',
  };
}

/**
 * B1–B8 能力登记（机器可读版，证据见 design/native-probes.md）。
 * supported=false 的项，UI 必须显示 reason，不得假装可用。
 */
function nativeSupport() {
  const s = {
    engineVersion: ENGINE_VERSION,
    subagents: {
      supported: true,
      toolNamespace: 'multi_agent_v1',        // v1（引擎默认；非目录模型/DeepSeek 即此路径）
      v2ToolNamespace: 'collaboration',
      v2OptIn: 'global.multiAgentV2=true → [features] multi_agent_v2',
      control: false,                          // 无控制 RPC：只能只读
      reason: 'app-server 无子代理控制 RPC（client 方法 154 个里没有）；停止子代理请用 turn/interrupt',
      evidence: 'probes §2',
    },
    goals: {
      supported: true,
      mechanism: ['tools:create_goal/get_goal/update_goal', 'rpc:thread/goal/get|set|clear', 'notify:thread/goal/updated|cleared'],
      autoContinuation: true,                  // active 目标会自己续跑回合
      reason: '目标 status=active 会让引擎自动续跑回合（实测 60s 内 758 条更新）；手动设置默认 paused',
      evidence: 'probes §3',
    },
    windowReset: {
      supported: true,
      mechanism: ['item:contextCompaction', 'notify:thread/compacted(deprecated)'],
      history: ['thread/items/list', 'thread/turns/list', 'thread/timeline/list', 'thread/read', 'thread/search'],
      reason: null,
      evidence: 'probes §4',
    },
    browserUse: {
      supported: false,
      reason: '配置面合法（[browser_use] 等）但工具不暴露：目录模型 experimental_supported_tools 全为 []，'
        + '目录里 browser_use 出现 0 次；本机无官方 provider 凭据 → 无法区分"服务端能力位/ provider 侧"，结论限定为本部署不可用',
      evidence: 'probes §5',
    },
    computerUse: {
      supported: false,
      reason: '同 browserUse（目录能力位为空）；注意 bundle_ids/aumids 是 map 不是数组',
      evidence: 'probes §5',
    },
    jsRepl: {
      supported: false,
      reason: 'feature js_repl 阶段为 removed（js_repl_tools_only 同）；打开 flag + 指向 Node 也无工具 → 不注入 Electron Node 路径',
      evidence: 'probes §6',
    },
    rolloutBudget: {
      supported: false,
      reason: '启用需 reminder_at_remaining_tokens，而该键写入即导致整份配置解析失败（引擎缺陷）；ROSE 不写该配置',
      evidence: 'probes §9',
    },
    applyPatchStreaming: { supported: true, default: true, evidence: 'probes §9' },
    sleepTool: { supported: true, default: true, evidence: 'probes §9' },
    toolSearch: {
      supported: false,
      reason: 'feature tool_search 阶段为 removed；工具是否出现取决于模型工具模式（目录模型 tool_mode=null 时有，非目录模型无）→ 不接线，保留证据',
      evidence: 'probes §9',
    },
    waitForEnvironment: { supported: false, reason: 'features list 与 app-server schema 中都不存在该能力', evidence: 'probes §9' },
    updatePlan: {
      supported: false,
      reason: '[tools] update_plan={} 被配置层接受，但工具表实测无 update_plan（保留探针，暴露即接）',
      evidence: 'probes §9',
    },
    skillSearch: { supported: true, default: true, evidence: 'probes §8' },
    skillMcpDependencyInstall: { supported: true, default: true, evidence: 'probes §8' },
  };
  return JSON.parse(JSON.stringify(s));
}

module.exports = {
  ENGINE_VERSION,
  applyPatchStreamingEnabled,
  featureLines,
  rolloutBudgetDecision,
  nativeSupport,
};
