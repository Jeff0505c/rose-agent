'use strict';
/**
 * ROSE MCP 注册表 —— 数据层（分层 + 激活），形态对齐 skills.js。
 * 存储：data/mcp-registry.json，元数据 { id, name, command, args, env, scope, roleId, active }。
 * scope = 'global'（所有角色可用）| 'role'（绑定 roleId 专属）。
 * 引擎在写 config.toml 时取 activeServersForRole(roleId)。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.ROSE_ROOT || path.resolve(__dirname, '..', '..');
const REGISTRY_PATH = path.join(ROOT, 'work', 'data', 'mcp-registry.json');

function writeFileAtomic(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function loadRegistry() {
  try {
    const j = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    return Array.isArray(j.servers) ? j.servers : [];
  } catch { return []; }
}
function saveRegistry(servers) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  writeFileAtomic(REGISTRY_PATH, JSON.stringify({ servers }, null, 2));
}

// 服务器类型：stdio（本地进程）| http（Streamable HTTP）| sse（旧远程）
function normType(t) {
  if (t === 'http' || t === 'streamable-http' || t === 'streamable_http') return 'http';
  if (t === 'sse') return 'sse';
  return 'stdio';
}
function normalizeServer(body, existing) {
  const prev = existing || {};
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : prev.name;
  if (!name) return { error: 'name 必填' };
  const type = body.type !== undefined ? normType(body.type) : (prev.type || 'stdio');
  if (type === 'stdio') {
    const command = typeof body.command === 'string' ? body.command.trim() : prev.command;
    if (!command) return { error: '本地服务器需要 command' };
    const args = Array.isArray(body.args) ? body.args.map(String) : (prev.args) || [];
    const env = (body.env && typeof body.env === 'object' && !Array.isArray(body.env))
      ? Object.fromEntries(Object.entries(body.env).filter(([, v]) => typeof v === 'string')) : (prev.env) || {};
    const scope = body.scope === 'role' ? 'role' : 'global';
    const roleId = scope === 'role' ? (body.roleId || prev.roleId || null) : null;
    return { type, name, command, args, env, scope, roleId };
  }
  // 远程（http/sse）
  const url = typeof body.url === 'string' && body.url.trim() ? body.url.trim() : prev.url;
  if (!url) return { error: type === 'sse' ? 'SSE 服务器需要 url' : 'HTTP 服务器需要 url' };
  let headers = {};
  if (body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)) {
    headers = Object.fromEntries(Object.entries(body.headers).filter(([, v]) => typeof v === 'string' && v));
  } else if (prev.headers && typeof prev.headers === 'object') headers = prev.headers;
  const scope = body.scope === 'role' ? 'role' : 'global';
  const roleId = scope === 'role' ? (body.roleId || prev.roleId || null) : null;
  return { type, name, url, headers, scope, roleId };
}

function addServer(body) {
  const n = normalizeServer(body);
  if (n.error) return { error: n.error };
  const reg = loadRegistry();
  if (reg.some((s) => s.name === n.name)) return { error: '同名服务器已存在' };
  const entry = {
    id: 'mcp-' + crypto.randomBytes(4).toString('hex'),
    type: n.type,
    name: n.name,
    scope: n.scope, roleId: n.roleId, active: true,
    createdAt: Date.now(),
    ...(n.type === 'stdio' ? { command: n.command, args: n.args, env: n.env } : { url: n.url, headers: n.headers }),
  };
  reg.push(entry);
  saveRegistry(reg);
  return { server: entry };
}

function updateServer(id, patch) {
  const reg = loadRegistry();
  const s = reg.find((x) => x.id === id);
  if (!s) return { error: '服务器不存在' };
  const touched = ['name', 'type', 'command', 'args', 'env', 'url', 'headers'].some((k) => patch[k] !== undefined);
  if (touched) {
    const n = normalizeServer({ ...s, ...patch }, s);
    if (n.error) return { error: n.error };
    if (reg.some((x) => x.id !== id && x.name === n.name)) return { error: '同名服务器已存在' };
    s.type = n.type;
    s.name = n.name;
    delete s.command; delete s.args; delete s.env; delete s.url; delete s.headers;
    Object.assign(s, n.type === 'stdio' ? { command: n.command, args: n.args, env: n.env } : { url: n.url, headers: n.headers });
  }
  if (patch.scope !== undefined) {
    if (!['global', 'role'].includes(patch.scope)) return { error: 'scope 非法' };
    s.scope = patch.scope;
  }
  if (patch.roleId !== undefined) s.roleId = patch.roleId || null;
  if (patch.active !== undefined) s.active = !!patch.active;
  saveRegistry(reg);
  return { server: s };
}

function deleteServer(id) {
  const reg = loadRegistry();
  if (!reg.some((x) => x.id === id)) return { error: '服务器不存在' };
  saveRegistry(reg.filter((x) => x.id !== id));
  return { ok: true };
}

// 角色删除联动：返回该角色名下所有 role 专属服务器（调用方决定删除或停用）
function serversForRole(roleId) {
  return loadRegistry().filter((s) => s.scope === 'role' && s.roleId === roleId);
}
function deleteServersForRole(roleId) {
  const reg = loadRegistry();
  const removed = reg.filter((s) => s.scope === 'role' && s.roleId === roleId);
  saveRegistry(reg.filter((s) => !(s.scope === 'role' && s.roleId === roleId)));
  return removed;
}
function deactivateServersForRole(roleId) {
  const reg = loadRegistry();
  let n = 0;
  for (const s of reg) if (s.scope === 'role' && s.roleId === roleId && s.active) { s.active = false; n++; }
  saveRegistry(reg);
  return n;
}

// 某角色应注入的激活 MCP 服务器（global active + 本角色 active），供 config.toml 生成
function activeServersForRole(roleId) {
  return loadRegistry().filter((s) => s.active && (s.scope === 'global' || (s.scope === 'role' && s.roleId === roleId)));
}

module.exports = {
  loadRegistry, saveRegistry, addServer, updateServer, deleteServer,
  serversForRole, deleteServersForRole, deactivateServersForRole, activeServersForRole,
};
