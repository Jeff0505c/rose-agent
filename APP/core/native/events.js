'use strict';
/**
 * codex 原生事件的映射与节流 · 纯函数，无 IO。
 *
 * 依据 design/native-probes.md（0.152.1 实测）：
 *  - 子代理**没有** collab_* 通知方法；真实载体是 ThreadItem:
 *      collabAgentToolCall { tool, status, senderThreadId, receiverThreadIds[], agentsStates{<tid>:{status,message}} }
 *      subAgentActivity    { kind, agentThreadId, agentPath }
 *  - goal 通知 `thread/goal/updated` 在 active 目标下会高频触发（实测 758 条/60s）→ 必须节流。
 */

/** CollabAgentStatus → 对外契约 state */
const AGENT_STATUS_TO_STATE = Object.freeze({
  pendingInit: 'spawned',
  running: 'running',
  interrupted: 'waiting',
  completed: 'done',
  errored: 'closed',
  shutdown: 'closed',
  notFound: 'closed',
});

/** SubAgentActivityKind → 对外契约 state */
const ACTIVITY_KIND_TO_STATE = Object.freeze({
  started: 'running',
  interacted: 'running',
  interrupted: 'waiting',
  completed: 'done',
});

function stateFromAgentStatus(status) {
  return AGENT_STATUS_TO_STATE[String(status == null ? '' : status)] || 'running';
}

function stateFromActivityKind(kind) {
  return ACTIVITY_KIND_TO_STATE[String(kind == null ? '' : kind)] || 'running';
}

/** collabAgentToolCall 的 tool/status → 契约 state（用于 agentsStates 缺失时的兜底） */
function stateFromToolCall(tool, status) {
  const t = String(tool || '');
  const st = String(status || '');
  if (t === 'spawnAgent' && st === 'inProgress') return 'spawned';
  if (t === 'closeAgent') return 'closed';
  if (t === 'wait') return 'waiting';
  if (t === 'interruptAgent') return 'waiting';
  if (t === 'resumeAgent') return 'running';
  return 'running';
}

/**
 * item: collabAgentToolCall → 每个受影响子代理一条记录（顺序稳定：receiverThreadIds 优先，再补 agentsStates 中未列出的）
 * 返回 [{ id, state, lastText?, tool, status, rawStatus }]
 */
function mapCollabAgentToolCall(item) {
  const it = item || {};
  const states = (it.agentsStates && typeof it.agentsStates === 'object') ? it.agentsStates : {};
  const ids = [];
  for (const id of (Array.isArray(it.receiverThreadIds) ? it.receiverThreadIds : [])) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  for (const id of Object.keys(states)) if (id && !ids.includes(id)) ids.push(id);
  return ids.map((id) => {
    const s = states[id] || {};
    const rawStatus = s.status != null ? s.status : null;
    return {
      id,
      state: rawStatus != null ? stateFromAgentStatus(rawStatus) : stateFromToolCall(it.tool, it.status),
      lastText: typeof s.message === 'string' && s.message ? s.message : undefined,
      tool: it.tool || null,
      status: it.status || null,
      rawStatus,
    };
  });
}

/** item: subAgentActivity → 单条记录（agentThreadId 为子代理线程 id） */
function mapSubAgentActivity(item) {
  const it = item || {};
  const id = it.agentThreadId || null;
  if (!id) return null;
  return {
    id,
    state: stateFromActivityKind(it.kind),
    kind: it.kind || null,
    agentPath: it.agentPath || null,
  };
}

/** ThreadGoal → 对外契约 goal 载荷（引擎没有 goal id → 用 threadId 当 id，不编造） */
function goalPayload(goal) {
  if (!goal || typeof goal !== 'object') return null;
  const threadId = goal.threadId || null;
  return {
    id: threadId,
    text: typeof goal.objective === 'string' ? goal.objective : '',
    status: goal.status || 'active',
    tokens: Number.isFinite(Number(goal.tokensUsed)) ? Number(goal.tokensUsed) : undefined,
    tokenBudget: Number.isFinite(Number(goal.tokenBudget)) ? Number(goal.tokenBudget) : undefined,
    timeUsedSeconds: Number.isFinite(Number(goal.timeUsedSeconds)) ? Number(goal.timeUsedSeconds) : undefined,
    updatedAt: Number.isFinite(Number(goal.updatedAt)) ? Number(goal.updatedAt) : undefined,
  };
}

function eventId(parts) {
  return parts.filter((p) => p !== null && p !== undefined && p !== '').join(':');
}

/**
 * goal 事件节流（Lead 硬要求：合并 + 每秒硬上限）：
 *  - 状态/目标/预算的**实质变化立即发**（goal 创建/完成不能延迟）；
 *  - 仅 tokens/time 变化按 intervalMs 合并（实测教训：active 目标 60 秒 758 条）；
 *  - 每会话每秒最多 maxPerSecond 条，超出**丢弃并计数**（dropped），
 *    计数进 payload/诊断，绝不静默（服务层还能再合并一层）。
 */
function createGoalThrottle(opts = {}) {
  const intervalMs = Number.isFinite(Number(opts.intervalMs)) ? Number(opts.intervalMs) : 500;
  const maxPerSecond = Number.isFinite(Number(opts.maxPerSecond)) && Number(opts.maxPerSecond) > 0
    ? Math.floor(Number(opts.maxPerSecond)) : 5;
  const last = new Map();
  return {
    intervalMs,
    maxPerSecond,
    shouldEmit(threadId, goal, now = Date.now()) {
      const fp = [goal && goal.status, goal && goal.text, goal && goal.tokenBudget].join('|');
      const prev = last.get(threadId);
      const meaningful = !prev || prev.fp !== fp;
      const elapsed = !prev || now - prev.at >= intervalMs;
      if (!meaningful && !elapsed) return false;
      // 每秒硬上限：滑动窗口内计数（窗口外的旧记录先衰减）
      const w = prev && now - (prev.windowAt || 0) < 1000 ? prev : null;
      const inWindow = w ? (w.count || 0) : 0;
      if (inWindow >= maxPerSecond) {
        last.set(threadId, { ...(w || {}), at: now, fp, windowAt: w ? w.windowAt : now, count: inWindow, dropped: ((prev && prev.dropped) || 0) + 1 });
        return false;
      }
      last.set(threadId, {
        at: now, fp, windowAt: w ? w.windowAt : now, count: inWindow + 1,
        dropped: (prev && prev.dropped) || 0,
      });
      return true;
    },
    droppedCount(threadId) { const p = last.get(threadId); return (p && p.dropped) || 0; },
    reset(threadId) { last.delete(threadId); },
    size() { return last.size; },
  };
}

/**
 * window-reset 计数与去重：`item:contextCompaction` 与 `thread/compacted` 可能成对到达，
 * 2 秒窗口内只算一次、只发一次，避免 UI 连弹两个"已换窗口"。
 */
function createWindowResetTracker(opts = {}) {
  const dedupeMs = Number.isFinite(Number(opts.dedupeMs)) ? Number(opts.dedupeMs) : 2000;
  const state = new Map(); // threadId -> { at, count }
  return {
    /** 返回 { emit, count } —— emit=false 表示同一窗口内的重复信号 */
    next(threadId, now = Date.now()) {
      const prev = state.get(threadId);
      if (prev && now - prev.at < dedupeMs) return { emit: false, count: prev.count };
      const count = (prev ? prev.count : 0) + 1;
      state.set(threadId, { at: now, count });
      return { emit: true, count };
    },
    countOf(threadId) { const p = state.get(threadId); return p ? p.count : 0; },
    reset(threadId) { state.delete(threadId); },
  };
}

module.exports = {
  AGENT_STATUS_TO_STATE,
  ACTIVITY_KIND_TO_STATE,
  stateFromAgentStatus,
  stateFromActivityKind,
  stateFromToolCall,
  mapCollabAgentToolCall,
  mapSubAgentActivity,
  goalPayload,
  eventId,
  createGoalThrottle,
  createWindowResetTracker,
};
