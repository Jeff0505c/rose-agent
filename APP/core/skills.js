'use strict';
/**
 * ROSE Skill 模块 —— 技能的数据层 + 导入/合规校验。
 * 零依赖：zip 解压走系统能力（macOS/Linux: unzip；Windows: PowerShell Expand-Archive，
 *         经 platform.unzipArgs 分派）；frontmatter 用轻量正则解析。
 *
 * 分层：scope = 'global'（全局通用）| 'role'（绑定某角色，roleId）。
 * 激活：active 决定是否注入；未激活不使用。
 * 存储：skills/<id>/ 平铺；元数据 data/skills-registry.json。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const platform = require('./platform');

const ROOT = process.env.ROSE_ROOT || path.resolve(__dirname, '..', '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const REGISTRY_PATH = path.join(ROOT, 'work', 'data', 'skills-registry.json');

/* ---------------- registry 读写 ---------------- */

// 原子写：同目录临时文件 + rename，避免进程中途退出留下半截 JSON
function writeFileAtomic(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function loadRegistry() {
  try {
    const j = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    return Array.isArray(j.skills) ? j.skills : [];
  } catch { return []; }
}
function saveRegistry(skills) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  writeFileAtomic(REGISTRY_PATH, JSON.stringify({ skills }, null, 2));
}

/* ---------------- 工具 ---------------- */

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

// 解析 SKILL.md 头部 frontmatter（key: value 行），返回 { name, description, ... }
function parseFrontmatter(text) {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) {
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (k) meta[k] = v;
      }
    }
  }
  return meta;
}

// 在目录内查找 SKILL.md（大小写不敏感），返回绝对路径或 null
function findSkillMd(dir) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.toLowerCase() === 'skill.md') return path.join(dir, name);
    }
  } catch { return null; }
  return null;
}

function safeCopy(srcDir, destDir) {
  fs.cpSync(srcDir, destDir, { recursive: true });
}

// 目录内是否含符号链接（防 zip 内软链指向敏感文件被复制/读取）
function hasSymlink(dir) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let names = [];
    try { names = fs.readdirSync(d); } catch { return true; }
    for (const n of names) {
      const p = path.join(d, n);
      let st;
      try { st = fs.lstatSync(p); } catch { return true; }
      if (st.isSymbolicLink()) return true;
      if (st.isDirectory()) stack.push(p);
    }
  }
  return false;
}

// 目录总大小（字节），出错返回 Infinity（视为超限）
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let names = [];
    try { names = fs.readdirSync(d); } catch { return Infinity; }
    for (const n of names) {
      const p = path.join(d, n);
      let st;
      try { st = fs.statSync(p); } catch { return Infinity; }
      if (st.isDirectory()) stack.push(p);
      else total += st.size;
    }
  }
  return total;
}
const MAX_SKILL_BYTES = 50 * 1024 * 1024; // 单次导入解压后总量上限 50MB

/* ---------------- 导入 ---------------- */

// 从已解压目录导入技能（支持根即 skill，或根下第一层多个 skill）
function importFromDir(srcDir, opts = {}) {
  const results = { imported: [], invalid: [] };
  const candidates = [];
  if (findSkillMd(srcDir)) candidates.push(srcDir);
  else {
    let names = [];
    try { names = fs.readdirSync(srcDir); } catch { names = []; }
    for (const n of names) {
      const p = path.join(srcDir, n);
      try { if (fs.statSync(p).isDirectory() && findSkillMd(p)) candidates.push(p); } catch {}
    }
  }
  if (!candidates.length) results.invalid.push({ name: '（根目录）', reason: '未找到 SKILL.md' });

  const reg = loadRegistry();
  for (const cand of candidates) {
    const md = findSkillMd(cand);
    let text = '';
    try { text = fs.readFileSync(md, 'utf8'); } catch { results.invalid.push({ name: path.basename(cand), reason: '无法读取 SKILL.md' }); continue; }
    if (hasSymlink(cand)) { results.invalid.push({ name: path.basename(cand), reason: '包含符号链接，已拒绝' }); continue; }
    if (dirSize(cand) > MAX_SKILL_BYTES) { results.invalid.push({ name: path.basename(cand), reason: '技能体积超过 50MB 上限' }); continue; }
    const meta = parseFrontmatter(text);
    if (!meta.name) { results.invalid.push({ name: path.basename(cand), reason: 'SKILL.md 缺少 name 字段' }); continue; }
    if (!meta.description) { results.invalid.push({ name: meta.name, reason: 'SKILL.md 缺少 description 字段' }); continue; }
    let id = slugify(meta.name) || ('skill-' + crypto.randomBytes(3).toString('hex'));
    // slugify 只保留 [a-z0-9_-]，但仍可能撞上 Windows 保留设备名（con/nul/com1…），
    // 那会让 skills/<id>/ 目录创建失败 → 统一用平台净化函数兜底（POSIX 下为恒等）
    id = platform.sanitizeFilename(id);
    // 同名冲突处理：默认覆盖
    const existing = reg.find((s) => s.id === id);
    const dest = path.join(SKILLS_DIR, id);
    if (existing) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} }
    fs.mkdirSync(dest, { recursive: true });
    try { safeCopy(cand, dest); } catch (e) { results.invalid.push({ name: meta.name, reason: '复制失败: ' + e.message }); continue; }
    const entry = {
      id,
      name: meta.name,
      description: meta.description || meta.name,
      scope: existing ? existing.scope : 'global',
      roleId: existing ? existing.roleId : null,
      active: existing ? existing.active : true,
      dir: path.join('skills', id),
      origin: 'imported',
    };
    const idx = reg.findIndex((s) => s.id === id);
    if (idx >= 0) reg[idx] = entry; else reg.push(entry);
    results.imported.push({ id, name: meta.name });
  }
  saveRegistry(reg);
  return results;
}

// 解压 zip（base64）到临时目录并导入；返回 { imported, invalid } 或 { error }
function importZip(base64) {
  if (typeof base64 !== 'string' || !base64) return { error: '缺少 zip 数据' };
  let buf;
  try { buf = Buffer.from(base64, 'base64'); } catch { return { error: 'zip 数据编码错误' }; }
  if (buf.length > MAX_SKILL_BYTES) return { error: 'zip 包超过 50MB 上限' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ja-skill-'));
  const zipPath = path.join(tmp, 'upload.zip');
  const outDir = path.join(tmp, 'out');
  try {
    fs.writeFileSync(zipPath, buf);
    fs.mkdirSync(outDir, { recursive: true });
    const u = platform.unzipArgs(zipPath, outDir);
    const r = spawnSync(u.cmd, u.args, { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) {
      const hint = r.error ? r.error.message : String(r.stderr || '').slice(0, 160);
      return { error: `解压失败（${platform.unzipStrategy().kind}）：${hint}` };
    }
    if (dirSize(outDir) > MAX_SKILL_BYTES) return { error: '解压后总量超过 50MB 上限' };
    return importFromDir(outDir);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

/* ---------------- 更新 / 删除 ---------------- */

function updateSkill(id, patch) {
  const reg = loadRegistry();
  const s = reg.find((x) => x.id === id);
  if (!s) return { error: '技能不存在' };
  if (patch.scope !== undefined) {
    if (!['global', 'role'].includes(patch.scope)) return { error: 'scope 非法' };
    s.scope = patch.scope;
  }
  if (patch.roleId !== undefined) s.roleId = patch.roleId || null;
  if (patch.active !== undefined) s.active = !!patch.active;
  saveRegistry(reg);
  return { ok: true, skill: s };
}

function deleteSkill(id) {
  const reg = loadRegistry();
  const s = reg.find((x) => x.id === id);
  if (!s) return { error: '技能不存在' };
  saveRegistry(reg.filter((x) => x.id !== id));
  try { fs.rmSync(path.join(SKILLS_DIR, id), { recursive: true, force: true }); } catch {}
  return { ok: true };
}

// 角色删除联动：返回该角色名下所有 role 技能；按需删除或置未激活
function skillsForRole(roleId) {
  return loadRegistry().filter((s) => s.scope === 'role' && s.roleId === roleId);
}
function deleteSkillsForRole(roleId) {
  const reg = loadRegistry();
  const keep = [], removed = [];
  for (const s of reg) {
    if (s.scope === 'role' && s.roleId === roleId) { removed.push(s); try { fs.rmSync(path.join(SKILLS_DIR, s.id), { recursive: true, force: true }); } catch {} }
    else keep.push(s);
  }
  saveRegistry(keep);
  return removed;
}
function deactivateSkillsForRole(roleId) {
  const reg = loadRegistry();
  let n = 0;
  for (const s of reg) { if (s.scope === 'role' && s.roleId === roleId && s.active) { s.active = false; n++; } }
  saveRegistry(reg);
  return n;
}

// 取某角色应注入的激活技能（全局 active + 该角色 active）
function activeSkillsForRole(roleId) {
  return loadRegistry().filter((s) => s.active && (s.scope === 'global' || (s.scope === 'role' && s.roleId === roleId)));
}

// 按技能 id 列表解析为 codex skill 引用 [{ name, path }]（path 指向 SKILL.md 绝对路径）
function getSkillRefs(ids) {
  const reg = loadRegistry();
  const out = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const s = reg.find((x) => x.id === id);
    if (!s) continue;
    out.push({ name: s.name, path: path.join(SKILLS_DIR, id, 'SKILL.md') });
  }
  return out;
}

// 从文件列表（前端文件夹读取结果）导入：{ path, base64 }[] → 写临时目录 → importFromDir
function importFromFiles(files) {
  if (!Array.isArray(files) || !files.length) return { error: '无文件' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ja-skillf-'));
  let total = 0;
  try {
    for (const f of files) {
      const rel = String(f.path || f.name || '').replace(/\\/g, '/');
      if (!rel || rel.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(rel)) continue; // 拒绝绝对路径与穿越
      let b64 = String(f.base64 || '');
      if (b64.includes(',')) b64 = b64.split(',').pop(); // 去 dataURL 前缀
      total += Math.floor(b64.length * 3 / 4);
      if (total > MAX_SKILL_BYTES) return { error: '导入总量超过 50MB 上限' };
      try {
        const dest = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
      } catch {}
    }
    return importFromDir(tmp);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

module.exports = {
  loadRegistry, saveRegistry,
  importFromDir, importZip, importFromFiles,
  updateSkill, deleteSkill,
  skillsForRole, deleteSkillsForRole, deactivateSkillsForRole,
  activeSkillsForRole, getSkillRefs,
  SKILLS_DIR,
};
