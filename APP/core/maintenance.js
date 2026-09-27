'use strict';
/**
 * 数据生命周期维护（产品化规划 C 阶段）—— 出厂清单 top-up + 升级前备份
 *
 * 对齐 DSH 的四条规则（design/productization-plan.md 一、C）：
 *  1. **只补缺失、绝不覆盖**：磁盘上已存在的文件一律不动（用户改过的原样保留）。
 *  2. **用户删过的不复活**：清单登记过但磁盘缺失 = 用户删的 → 永不补回。
 *  3. **只补"缺失且从未播种过"**：磁盘没有 + 清单没有 = 本版本新增 → 复制。
 *  4. **技能以 work/data/skills-registry.json 为唯一事实源**：补技能文件必须同时补注册表条目，
 *     否则产生"文件在、界面看不到"的孤儿（v0.22.2 同类问题）。
 *
 * 设计：纯函数 + 薄 IO。时间（now）/版本（version）/目录（root、defaultsDir）一律由调用方注入，
 * 便于离线断言；`onStartup` 是唯一编排入口（版本变化 → 备份 → top-up → 写清单）。
 *
 * 本文件与 seed.js 的分工：seed.js 只负责"首次安装播种"，本文件负责"升级期维护"。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SENTINEL = '.seeded';                 // 出厂清单文件（旧版是纯文本时间戳 → legacy）
const BACKUP_DIRNAME = 'backups';           // ROOT/work/backups
const BACKUP_KEEP = 3;                      // 升级备份保留份数（任务口径）
// 升级备份内容：roles/**（角色人格/记忆/_global，含 settings.json）+ work/data/**
// Lead 裁定：D 阶段的"备份数据后重置"会动 roles/_global/settings.json，只备份 work/data 救不回它。
const BACKUP_SETS = ['roles', 'work/data'];
// 备份时必须排除的 ROOT 相对路径（否则 work/backups 会被备份进自己，嵌套自增）
const BACKUP_EXCLUDE = ['work/backups'];
const STATUS_REL = 'work/data/maintenance.json';   // 最近一次维护结果（诊断导出用；无维护则不写）

// 出厂目录 → 用户数据目录的落位映射（与 seed.js 的播种口径保持一致）
const REGISTRY_DESTS = {
  'registries/skills-registry.json': 'work/data/skills-registry.json',
  'registries/mcp-registry.json': 'work/data/mcp-registry.json',
};
// 各注册表的条目数组键名
const REGISTRY_KEYS = {
  'work/data/skills-registry.json': 'skills',
  'work/data/mcp-registry.json': 'servers',
};

/* ==================== 基础工具（纯 / 薄 IO） ==================== */

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/** 目录树 → 排序后的相对路径列表（只收常规文件；符号链接一律跳过，避免链接环/越界读取） */
function scanDir(dir) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(dir, rel || '.'), { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk('');
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function modeOf(file) {
  try { return fs.statSync(file).mode & 0o777; } catch { return 0o600; }
}

/**
 * 原子写（同目录 tmp + rename），并落到指定权限（默认 0o600 = 仅属主可读）。
 * 清单是"出厂投递记录"，含用户目录结构信息，权限与 DSH 的崩溃报告同级。
 */
function writeFileAtomic(file, data, mode = 0o600) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(file) + '.tmp-' + process.pid + '-' + Date.now());
  try {
    fs.writeFileSync(tmp, data, { mode });
    try { fs.chmodSync(tmp, mode); } catch { /* 某些文件系统不支持，忽略 */ }
    fs.renameSync(tmp, file);   // 同目录 rename 原子：要么旧内容、要么新内容，不会半截
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 清理失败不影响主流程 */ }
    throw e;
  }
  try { fs.chmodSync(file, mode); } catch { /* 忽略 */ }
  return file;
}

/** 非破坏复制：目标不存在才复制（绝不覆盖）；返回复制文件数 */
function copyTreeNonDestructive(src, dest) {
  let st;
  try { st = fs.statSync(src); } catch { return 0; }
  if (st.isDirectory()) {
    let n = 0;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) n += copyTreeNonDestructive(path.join(src, name), path.join(dest, name));
    return n;
  }
  if (!st.isFile()) return 0;
  if (fs.existsSync(dest)) return 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return 1;
}

/**
 * 带排除的非破坏复制（备份专用）：exclude 是 ROOT 相对路径前缀，命中即整棵跳过。
 * 用于避免 work/backups 被备份进自己（嵌套自增）。
 */
function copyTreeExcluding(srcAbs, destAbs, rootRel, exclude) {
  const rel = String(rootRel || '').replace(/^\/+|\/+$/g, '');
  for (const ex of exclude || []) {
    const e = String(ex).replace(/^\/+|\/+$/g, '');
    if (rel === e || rel.startsWith(e + '/')) return 0;
  }
  let st;
  try { st = fs.statSync(srcAbs); } catch { return 0; }
  if (st.isDirectory()) {
    let n = 0;
    fs.mkdirSync(destAbs, { recursive: true });
    for (const name of fs.readdirSync(srcAbs)) {
      n += copyTreeExcluding(path.join(srcAbs, name), path.join(destAbs, name), rel ? rel + '/' + name : name, exclude);
    }
    return n;
  }
  if (!st.isFile()) return 0;
  if (fs.existsSync(destAbs)) return 0;
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
  return 1;
}

/** UTC 时间戳（文件名安全）：20260926T213045Z */
function utcStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
    + `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** 版本号净化（进文件名）：只留 [0-9A-Za-z._-] */
function safeVersion(v) {
  return String(v == null ? '' : v).replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 40);
}

/** 相对路径 → 技能 id（skills/<id>/...）；非技能返回 null */
function skillIdOf(rel) {
  const m = /^skills\/([^/]+)\//.exec(String(rel || ''));
  return m ? m[1] : null;
}

/* ==================== 出厂清单（.seeded）读写 ==================== */

/**
 * 读清单三态：
 *  - missing：文件不存在（播种尚未发生 / 用户删了）
 *  - legacy ：存在但不是 JSON 清单（旧版纯文本时间戳）→ 只登记、不复制
 *  - normal ：{ version, at, files:{相对路径:sha256} }
 */
function readSeedManifest(root) {
  const file = path.join(root, SENTINEL);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { state: 'missing', file, manifest: null }; }
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!json || typeof json !== 'object' || Array.isArray(json)
      || !json.files || typeof json.files !== 'object' || Array.isArray(json.files)) {
    return { state: 'legacy', file, manifest: { version: null, at: null, files: {}, raw: String(text).trim().slice(0, 200) } };
  }
  const files = {};
  for (const [k, v] of Object.entries(json.files)) if (typeof v === 'string') files[k] = v;
  return {
    state: 'normal',
    file,
    manifest: {
      version: typeof json.version === 'string' ? json.version : null,
      at: typeof json.at === 'string' ? json.at : null,
      files,
    },
  };
}

/** 写清单：原子 + 0o600；files 按键排序，保证内容可复现（同一输入同一文件） */
function writeSeedManifest(root, manifest) {
  const files = {};
  for (const k of Object.keys((manifest && manifest.files) || {}).sort()) files[k] = manifest.files[k];
  const body = JSON.stringify({
    version: (manifest && manifest.version) || null,
    at: (manifest && manifest.at) || new Date().toISOString(),
    files,
  }, null, 2) + '\n';
  const file = writeFileAtomic(path.join(root, SENTINEL), body, 0o600);
  return file;
}

/* ==================== 出厂目录扫描 ==================== */

/**
 * 扫描出厂默认目录，得到"投递清单"与"出厂注册表条目"。
 * 返回 files[] 的 rel 是**用户数据目录（ROOT）相对路径**（registries/*.json → work/data/*.json），
 * src 是出厂源文件的绝对路径；kind='registry' 的条目是事实源，永不复制/覆盖。
 */
function scanDefaults(defaultsDir) {
  if (!defaultsDir || !fs.existsSync(defaultsDir)) return { ok: false, files: [], skills: [], registries: {} };
  const files = [];
  for (const srcRel of scanDir(defaultsDir)) {
    const abs = path.join(defaultsDir, srcRel);
    let buf;
    try { buf = fs.readFileSync(abs); } catch { continue; }
    // registries/ 下未映射的文件是**出厂规则文件**（如 mcp-registry-retired.json）：只读消费，不投递/不登记
    if (srcRel.startsWith('registries/') && !REGISTRY_DESTS[srcRel]) continue;
    const destRel = REGISTRY_DESTS[srcRel] || srcRel;
    files.push({
      rel: destRel, src: abs, srcRel,
      sha256: sha256(buf), size: buf.length,
      kind: REGISTRY_DESTS[srcRel] ? 'registry' : 'file',
    });
  }
  const registries = {};
  for (const [srcRel, destRel] of Object.entries(REGISTRY_DESTS)) {
    const key = REGISTRY_KEYS[destRel];
    const j = readJson(path.join(defaultsDir, srcRel));
    registries[destRel] = {
      key, destRel,
      entries: (j && Array.isArray(j[key])) ? j[key] : [],
      ok: !!(j && Array.isArray(j[key])),
    };
  }
  const skillFiles = new Map();
  for (const f of files) {
    if (f.kind !== 'file') continue;
    const id = skillIdOf(f.rel);
    if (!id) continue;
    if (!skillFiles.has(id)) skillFiles.set(id, []);
    skillFiles.get(id).push(f.rel);
  }
  const factorySkillEntries = new Map();
  for (const e of (registries['work/data/skills-registry.json'] || {}).entries || []) {
    if (e && e.id) factorySkillEntries.set(e.id, e);
  }
  const skills = [...skillFiles.keys()].sort().map((id) => ({
    id, files: skillFiles.get(id), entry: factorySkillEntries.get(id) || null,
  }));
  return { ok: true, files, skills, registries };
}

/** 出厂文件中"磁盘上已存在"的 rel 列表（供 planTopUp 的 existing 入参） */
function existingOf(root, files) {
  const out = [];
  for (const f of files || []) {
    if (!f || !f.rel || f.kind === 'registry') continue;
    try { if (fs.existsSync(path.join(root, f.rel))) out.push(f.rel); } catch { /* 忽略 */ }
  }
  return out;
}

/* ==================== 冻结后变更：覆盖语义 / 技能退役（数据驱动） ==================== */

/** 读文件 sha256（读取失败返回 null） */
function hashFile(abs) {
  try { return sha256(fs.readFileSync(abs)); } catch { return null; }
}

/** 从 localHashes（object 或 Map）取某 rel 的哈希；缺省 null = 未知（按"用户改过"保守处理） */
function hashOf(local, rel) {
  if (!local) return null;
  if (local instanceof Map) return local.has(rel) ? local.get(rel) : null;
  return Object.prototype.hasOwnProperty.call(local, rel) ? local[rel] : null;
}

/**
 * 出厂注册表里"被新版取代/退役"的技能 → Map<id, supersededBy>。
 * **完全数据驱动**：只认注册表条目上的 `supersededBy`（或 `retired: true`），不写死任何技能 id。
 */
function supersededSkills(factoryRegistry) {
  const out = new Map();
  const reg = factoryRegistry && factoryRegistry['work/data/skills-registry.json'];
  const entries = (reg && reg.entries) || (factoryRegistry && factoryRegistry.skills) || [];
  for (const e of entries) {
    if (!e || !e.id) continue;
    const by = typeof e.supersededBy === 'string' ? e.supersededBy.trim() : '';
    if (by || e.retired === true) out.set(e.id, by || '(retired)');
  }
  return out;
}

/** 某技能 id 在用户目录里的实际文件（ROOT 相对路径）；目录不存在返回 [] */
function localSkillFiles(root, id) {
  const dir = path.join(root, 'skills', String(id));
  return scanDir(dir).map((rel) => `skills/${id}/${rel}`);
}

/* ==================== top-up 计划（纯函数） ==================== */

/**
 * 只补缺失、绝不覆盖、用户删过的不复活。
 * @param {object} p
 * @param {Array}  p.defaults        出厂文件（scanDefaults().files：{rel,sha256,kind}）
 * @param {object} p.manifest        当前清单（{version,files}），null 视为空清单
 * @param {Array}  p.existing        磁盘已存在的 ROOT 相对路径
 * @param {object} p.registry        当前 work/data/skills-registry.json（{skills:[...]}）
 * @param {object} p.factoryRegistry 出厂注册表（scanDefaults().registries）
 * @returns {{copy:string[], registryAdd:object[], skippedExisting:string[],
 *            skippedUserDeleted:string[], skippedUnregistered:string[], registered:object}}
 */
function planTopUp({ defaults = [], manifest = null, existing = [], registry = null, factoryRegistry = null, localHashes = null } = {}) {
  const shipped = (manifest && manifest.files) || {};
  const have = new Set(existing || []);
  const superseded = supersededSkills(factoryRegistry);
  const currentSkillIds = new Set(
    (((registry || {}).skills) || []).map((s) => s && s.id).filter(Boolean));
  const factorySkillEntries = new Map();
  const freg = factoryRegistry && factoryRegistry['work/data/skills-registry.json'];
  const fEntries = (freg && freg.entries) || (factoryRegistry && factoryRegistry.skills) || [];
  for (const e of fEntries) if (e && e.id) factorySkillEntries.set(e.id, e);

  const copy = [];              // 4：本机无 + 清单无 = 本代新增
  const overwrite = [];         // 1：本机内容 == 清单记录（未被改过）→ 用新出厂文件覆盖
  const keepModified = [];      // 2：本机内容 != 清单记录（用户改过）→ 保留 + 记录"出厂有新版"
  const registryAdd = [];
  const skippedExisting = [];       // 出厂未变（记录 == 出厂）
  const skippedUserDeleted = [];    // 3：清单登记过但本机没有 = 用户删过 → 不复活
  const skippedUnregistered = [];   // 技能注册表无条目且出厂也没有 → 不造孤儿
  const skippedSuperseded = [];     // 5：被新版取代的出厂文件 → 不投递（由退役流程处理）
  const addIds = new Set();

  for (const f of defaults) {
    if (!f || !f.rel || f.kind === 'registry') continue;   // 注册表是事实源：永不复制/覆盖
    const rel = f.rel;
    const sid = skillIdOf(rel);
    if (sid && superseded.has(sid)) { skippedSuperseded.push(rel); continue; }
    if (have.has(rel)) {
      const recorded = shipped[rel];
      if (recorded === f.sha256) { skippedExisting.push(rel); continue; }        // 出厂未变 → 不动
      const local = hashOf(localHashes, rel);
      if (local && local === recorded) { overwrite.push(rel); continue; }        // 1
      keepModified.push({ rel, localSha: local, recordedSha: recorded || null, factorySha: f.sha256 });   // 2
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(shipped, rel)) { skippedUserDeleted.push(rel); continue; }    // 3
    if (sid && !currentSkillIds.has(sid) && !addIds.has(sid)) {
      // 技能必须以注册表为唯一事实源：没有条目就补条目，补不了条目就不投文件（否则是孤儿）
      const entry = factorySkillEntries.get(sid);
      if (!entry) { skippedUnregistered.push(rel); continue; }
      addIds.add(sid);
      registryAdd.push(entry);
    }
    copy.push(rel);                                                                                        // 4
  }

  // 新清单：登记全部出厂文件（含用户删过的 → 保持"不复活"）；退役与缺条目项除外
  const blocked = new Set(skippedUnregistered);
  const registered = { ...shipped };
  for (const f of defaults) {
    if (!f || !f.rel || f.kind === 'registry') continue;
    const sid = skillIdOf(f.rel);
    if (sid && superseded.has(sid)) { delete registered[f.rel]; continue; }   // 退役：不再登记（未来若取消退役则按新增投递）
    if (blocked.has(f.rel)) continue;
    registered[f.rel] = f.sha256;
  }
  const upgradeAvailable = keepModified.map((x) => ({ rel: x.rel, factorySha: x.factorySha, recordedSha: x.recordedSha, localSha: x.localSha }));
  return { copy, overwrite, keepModified, upgradeAvailable, registryAdd, skippedExisting, skippedUserDeleted, skippedUnregistered, skippedSuperseded, supersededIds: [...superseded.keys()], registered };
}

/**
 * 技能退役计划（纯函数，规则 5）：出厂注册表标记 supersededBy 的技能，
 *  - 目录内文件全部与出厂记录一致（用户没改过）→ 退役：整目录移入 work/backups/superseded-skills-<ts>/ + 注册表条目移除
 *  - 有文件被用户改过（或不在出厂清单里）→ 保留 + 记冲突（绝不静默删用户内容）
 */
function planRetire({ manifest = null, registry = null, factoryRegistry = null, localHashes = null, dirFiles = null } = {}) {
  const superseded = supersededSkills(factoryRegistry);
  const shipped = (manifest && manifest.files) || {};
  const userEntries = new Map(((((registry || {}).skills) || [])).map((s) => [s && s.id, s]).filter(([id]) => id));
  const filesOf = (id) => {
    if (!dirFiles) return [];
    if (dirFiles instanceof Map) return dirFiles.get(id) || [];
    return dirFiles[id] || [];
  };
  const retire = [];
  const conflicts = [];
  const clean = [];
  for (const [id, by] of superseded) {
    const hadEntry = userEntries.has(id);
    const files = filesOf(id);
    if (!hadEntry && files.length === 0) { clean.push({ id, supersededBy: by, why: '注册表与目录都不存在（已退役过）' }); continue; }
    const modified = [];
    for (const rel of files) {
      const recorded = shipped[rel];
      const local = hashOf(localHashes, rel);
      if (!recorded) { modified.push({ rel, why: '不在出厂清单（用户新增/导入）' }); continue; }
      if (local !== recorded) modified.push({ rel, why: '内容与出厂记录不一致（用户改过）' });
    }
    if (modified.length) { conflicts.push({ id, supersededBy: by, files, modified }); continue; }
    retire.push({ id, supersededBy: by, files, hadEntry });
  }
  return { retire, conflicts, clean };
}

/** 从注册表按 id 移除条目（原子写、保留其它条目与权限）；解析失败时不写坏文件 */
function removeRegistryEntries(root, destRel, key, ids, log = () => {}) {
  const want = new Set((ids || []).filter(Boolean));
  if (!want.size) return { removed: [] };
  const file = path.join(root, destRel);
  if (!fs.existsSync(file)) return { removed: [] };
  const cur = readJson(file);
  if (!cur || typeof cur !== 'object' || Array.isArray(cur) || !Array.isArray(cur[key])) {
    log(`[maintenance] 注册表 ${destRel} 结构异常/损坏，跳过条目移除（不覆盖）`);
    return { removed: [], error: 'registry-unreadable' };
  }
  const kept = cur[key].filter((e) => !(e && want.has(e.id)));
  const removed = cur[key].filter((e) => e && want.has(e.id)).map((e) => e.id);
  if (!removed.length) return { removed: [] };
  writeFileAtomic(file, JSON.stringify({ ...cur, [key]: kept }, null, 2) + '\n', modeOf(file));
  return { removed };
}

/** 执行退役（薄 IO，绝不 throw）：整目录移入 work/backups/superseded-skills-<ts>/ + 移除注册表条目 */
function applyRetire({ root, plan, registryRel = 'work/data/skills-registry.json', registryKey = 'skills', now = new Date(), log = () => {} } = {}) {
  const backupName = `superseded-skills-${utcStamp(now)}`;
  const baseDir = path.join(backupRoot(root), backupName);
  const moved = [];
  const removedEntries = [];
  const failed = [];
  for (const item of ((plan && plan.retire) || [])) {
    try {
      if (item.files && item.files.length) {
        const from = path.join(root, 'skills', item.id);
        const to = path.join(baseDir, item.id);
        if (fs.existsSync(from)) {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.renameSync(from, to);      // 整目录移入备份：可整目录回退
          moved.push({ id: item.id, from, to, files: item.files.length });
        }
      }
      if (item.hadEntry) {
        const r = removeRegistryEntries(root, registryRel, registryKey, [item.id], log);
        if (r.error) failed.push({ id: item.id, error: r.error });
        else if (r.removed.length) removedEntries.push(item.id);
      }
    } catch (e) {
      failed.push({ id: item.id, error: (e && e.message) || String(e) });
      log(`[maintenance] 技能退役失败 ${item.id}：${(e && e.message) || e}`);
    }
  }
  return {
    backupName: fs.existsSync(baseDir) ? backupName : null,
    backupDir: fs.existsSync(baseDir) ? baseDir : null,
    moved, removedEntries, failed,
  };
}

/** 是否需要升级维护：清单版本 ≠ 当前版本（清单无版本号 = legacy，由 onStartup 单独处理） */
function planUpgrade({ version = null, manifest = null } = {}) {
  const from = (manifest && typeof manifest.version === 'string') ? manifest.version : null;
  const to = version ? String(version) : null;
  return { needed: !!to && from !== to, from, to, hasPriorVersion: !!from };
}

/* ==================== 注册表只增不覆盖 ==================== */

/**
 * 把出厂条目并入用户注册表：**只增不覆盖**（同 id 已存在则原样保留用户设置）。
 * 返回 {added:[id], total, error?}；解析失败时不动原文件（error），避免把用户注册表写坏。
 */
function mergeRegistryEntries(root, destRel, key, entries, log = () => {}) {
  if (!entries || !entries.length) return { added: [], total: null };
  const file = path.join(root, destRel);
  const existed = fs.existsSync(file);
  let cur = null;
  if (existed) {
    cur = readJson(file);
    if (!cur || typeof cur !== 'object' || Array.isArray(cur) || !Array.isArray(cur[key])) {
      log(`[maintenance] 注册表 ${destRel} 结构异常/损坏，跳过并入（不覆盖）`);
      return { added: [], total: null, error: 'registry-unreadable' };
    }
  } else {
    cur = { [key]: [] };
  }
  const have = new Set(cur[key].map((e) => e && e.id).filter(Boolean));
  const added = [];
  for (const e of entries) {
    if (!e || !e.id || have.has(e.id)) continue;
    cur[key].push(e);
    have.add(e.id);
    added.push(e.id);
  }
  if (!added.length) return { added: [], total: cur[key].length };
  writeFileAtomic(file, JSON.stringify(cur, null, 2) + '\n', existed ? modeOf(file) : 0o600);
  return { added, total: cur[key].length };
}

/* ==================== 升级前备份 ==================== */

function backupRoot(root) { return path.join(root, 'work', BACKUP_DIRNAME); }

/** 备份目录列表（按名字升序；名字 = <版本>-<UTC>，UTC 后缀字典序即时间序） */
function listBackups(root) {
  const base = backupRoot(root);
  let names = [];
  try {
    names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return []; }
  names.sort();
  return names.map((name) => ({ name, dir: path.join(base, name) }));
}

/** 只保留最近 keep 份（默认 3），更早的整目录删除 */
function pruneBackups({ root, keep = BACKUP_KEEP, log = () => {} } = {}) {
  const n = Number.isFinite(keep) && keep > 0 ? Math.floor(keep) : BACKUP_KEEP;
  // 退役备份（superseded-skills-*）是技能回退路径，永不被裁剪
  const all = listBackups(root).filter((b) => !/^superseded-skills-/.test(b.name));
  const removed = [];
  while (all.length > n) {
    const victim = all.shift();
    try { fs.rmSync(victim.dir, { recursive: true, force: true }); removed.push(victim.name); }
    catch (e) { log(`[maintenance] 清理旧备份失败 ${victim.name}：${(e && e.message) || e}`); }
  }
  return { kept: all.map((b) => b.name), removed };
}

/**
 * 升级前备份：work/backups/<旧版本>-<UTC>/（幂等：同名目录已存在则复用，不重复拷贝）
 * 内容 = roles/** + work/data/**（排除 work/backups 自身）+ BACKUP.json 元信息；保留最近 keep 份
 */
function backupBeforeUpgrade({ root, fromVersion, toVersion, now = new Date(), keep = BACKUP_KEEP, sets = BACKUP_SETS, exclude = BACKUP_EXCLUDE, log = () => {} } = {}) {
  const name = `${safeVersion(fromVersion) || 'unknown'}-${utcStamp(now)}`;
  const dir = path.join(backupRoot(root), name);
  if (fs.existsSync(dir)) {
    return { dir, name, reused: true, copied: 0, sets, pruned: [], kept: listBackups(root).map((b) => b.name) };
  }
  fs.mkdirSync(dir, { recursive: true });
  let copied = 0;
  for (const rel of sets) copied += copyTreeExcluding(path.join(root, rel), path.join(dir, rel), rel, exclude);
  try {
    writeFileAtomic(path.join(dir, 'BACKUP.json'), JSON.stringify({
      from: fromVersion || null, to: toVersion || null, at: now.toISOString(), sets, exclude, copied,
    }, null, 2) + '\n', 0o600);
  } catch (e) { log(`[maintenance] 备份元信息写入失败（不影响备份本体）：${(e && e.message) || e}`); }
  const pruned = pruneBackups({ root, keep, log });
  return { dir, name, reused: false, copied, sets, pruned: pruned.removed, kept: pruned.kept };
}

/* ==================== 最近一次维护结果（诊断可见） ==================== */

/** 读最近一次维护状态（无则 null）。诊断导出读它，让"这一代没补"这件事可见。 */
function readMaintenanceStatus(root) {
  const j = readJson(path.join(root, STATUS_REL));
  return (j && typeof j === 'object') ? j : null;
}

/** 写最近一次维护状态（原子 + 0o600；只在真的发生维护时写，正常启动零写入） */
function writeMaintenanceStatus(root, status) {
  try {
    return writeFileAtomic(path.join(root, STATUS_REL), JSON.stringify(status, null, 2) + '\n', 0o600);
  } catch { return null; }   // 状态写不进去不影响维护本体
}

/** 日志里最多列这么多条路径，避免刷屏（完整列表在维护状态文件里） */
const LOG_LIST_MAX = 20;
function fmtList(list) {
  const arr = list || [];
  const head = arr.slice(0, LOG_LIST_MAX).join('、');
  return arr.length > LOG_LIST_MAX ? `${head} …（共 ${arr.length} 条，完整清单见 ${STATUS_REL}）` : head;
}

/* ==================== 历史 MCP 退役清理（数据驱动 + 指纹双条件） ==================== */

const RETIRED_MCP_REL = 'registries/mcp-registry-retired.json';

const mcpNorm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const mcpBasename = (v) => String(v == null ? '' : v).trim().replace(/\\/g, '/').split('/').pop().toLowerCase();

/**
 * 读出厂 MCP 退役规则（`defaults/registries/mcp-registry-retired.json`，runtime-office 维护）。
 * **规则文件不是用户数据**：本函数只读；无 `match.command` 的条目一律不消费（安全兜底）。
 * @returns {{ok:boolean, file:string, retirements:Array, pending:string[]}}
 */
function readMcpRetirementRules(defaultsDir) {
  const file = path.join(defaultsDir || '', RETIRED_MCP_REL);
  const j = readJson(file);
  if (!j || typeof j !== 'object') return { ok: false, file, retirements: [], pending: [] };
  const pend = (((j.pendingDecision || {}).entries) || [])
    .map((e) => mcpNorm(typeof e === 'string' ? e : (e && (e.name || e.id))))
    .filter(Boolean);
  const retirements = [];
  for (const e of (Array.isArray(j.retired) ? j.retired : [])) {
    if (!e || typeof e !== 'object') continue;
    const name = String(e.name || '').trim();
    const m = e.match || {};
    const type = mcpNorm(m.type || 'stdio') || 'stdio';
    // 指纹两种变体（规则文件 matchPolicy.fingerprintVariants）：
    //  - stdio：command 精确 + argsPrefix 逐项前缀
    //  - http ：注册表条目 url 以 urlPrefix 开头（旧版远程 MCP 没有 command/args）
    const isHttp = type === 'http';
    const hasFingerprint = isHttp ? !!String(m.urlPrefix || '').trim() : !!String(m.command || '').trim();
    if (!name || !hasFingerprint) continue;               // 没指纹不消费：宁可漏删，不可误删
    // args 语义（runtime-office 2026-09-27 修订）：`match.args` + `match.argsMatch`（默认 exact = 逐项精确且长度一致）。
    // 兼容旧字段 argsPrefix（无 argsMatch 时按 prefix）。**不做**标准前缀匹配：`mcp-server-time` 是
    // `mcp-server-time-custom` 的前缀，前缀匹配会误删用户自加的同名条目（他们的负例实测抓过）。
    const hasArgs = Array.isArray(m.args) || Array.isArray(m.argsPrefix);
    const pinnedArgs = hasArgs ? (Array.isArray(m.args) ? m.args : m.argsPrefix).map((x) => String(x)) : [];
    const argsMatch = m.argsMatch === 'prefix' ? 'prefix' : (m.argsMatch === 'exact' ? 'exact' : (Array.isArray(m.args) ? 'exact' : 'prefix'));
    retirements.push({
      name, key: mcpNorm(name), type,
      command: m.command == null ? null : String(m.command),
      // 可选：command 的 basename 白名单（v0.22.0 之前出厂过绝对路径形态，如 …/tools/github-mcp-server[.exe]）
      commandBasenames: Array.isArray(m.commandBasenames) ? m.commandBasenames.map((x) => String(x)) : [],
      args: hasArgs ? pinnedArgs : [],
      argsMatch,
      urlPrefix: m.urlPrefix == null ? null : String(m.urlPrefix).trim(),
      reason: e.reason || null, replacement: e.replacement || null,
    });
  }
  return { ok: true, file, retirements, pending: pend };
}

/**
 * 指纹匹配（禁止只按名字删）：
 *  - stdio：`command`（按 basename 归一，容忍绝对路径）精确 **且** `argsPrefix` 逐项前缀
 *  - http ：注册表条目 `url` 以 `match.urlPrefix` 开头（旧版远程 MCP 无 command/args）
 */
function mcpFingerprintMatches(entry, rule) {
  if (!entry || !rule) return false;
  if (rule.type === 'http') {
    // 与 runtime-office 参考 matcher 一致：必须是 http 类型条目 + url 前缀命中
    const url = String(entry.url == null ? '' : entry.url).trim();
    const pre = String(rule.urlPrefix == null ? '' : rule.urlPrefix).trim();
    return mcpNorm(entry.type) === 'http' && !!url && !!pre && url.startsWith(pre);
  }
  // command：精确相等 **或** basename ∈ commandBasenames（`\`→`/` 归一、大小写不敏感）。
  // 专为 v0.22.0 之前出厂的绝对路径条目保留；basename 不在清单内一律不命中（宁可漏退，不可误删）。
  const cmdExact = String(entry.command == null ? '' : entry.command) === String(rule.command == null ? '' : rule.command);
  const baseList = (rule.commandBasenames || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const cmdByBasename = baseList.length > 0 && baseList.includes(mcpBasename(entry.command));
  if (!cmdExact && !cmdByBasename) return false;
  const actual = (Array.isArray(entry.args) ? entry.args : []).map((a) => String(a));
  const pinned = (rule.args || []).map((a) => String(a));
  if ((rule.argsMatch || 'exact') === 'exact') {
    return actual.length === pinned.length && pinned.every((x, i) => actual[i] === x);
  }
  if (actual.length < pinned.length) return false;
  return pinned.every((x, i) => actual[i].startsWith(x));
}

/**
 * 退役计划（纯函数）：`name` 命中 **且** 指纹命中才退役；
 * `pendingDecision.entries` 一律保留；用户自加（名字不在清单）一律保留。
 */
function planMcpRetire({ registry = null, rules = null } = {}) {
  const servers = Array.isArray((registry || {}).servers) ? registry.servers : [];
  const retirements = (rules && rules.retirements) || [];
  const pending = new Set((rules && rules.pending) || []);
  const byKey = new Map(retirements.map((r) => [r.key, r]));
  const remove = [];
  const kept = [];
  const nameMatchedButFingerprintMismatch = [];
  servers.forEach((s, index) => {
    if (!s || typeof s !== 'object') { kept.push({ index, id: null, name: null }); return; }
    const key = mcpNorm(s.name);
    const rule = key ? byKey.get(key) : null;
    if (!rule || pending.has(key)) { kept.push({ index, id: s.id || null, name: s.name || null }); return; }   // 用户自加 / pending：不动
    if (!mcpFingerprintMatches(s, rule)) {
      kept.push({ index, id: s.id || null, name: s.name || null });
      nameMatchedButFingerprintMismatch.push({ index, id: s.id || null, name: s.name || null });
      return;                                             // 同名但指纹不符 → 不动（防误删用户同名条目）
    }
    remove.push({ index, id: s.id || null, name: s.name, reason: rule.reason, replacement: rule.replacement });
  });
  return { remove, removeIndexes: remove.map((x) => x.index), kept, nameMatchedButFingerprintMismatch, total: servers.length };
}

/**
 * 执行 MCP 退役（薄 IO）：**先整份备份** → 原子写回；注册表损坏/备份失败一律不动原文件；幂等（无命中即零写入）。
 */
function applyMcpRetire({ root, registryRel = 'work/data/mcp-registry.json', registryKey = 'servers', rules = null, now = new Date(), log = () => {} } = {}) {
  const file = path.join(root, registryRel);
  const cur = readJson(file);
  if (!cur || typeof cur !== 'object' || Array.isArray(cur) || !Array.isArray(cur[registryKey])) {
    log(`[maintenance] MCP 注册表 ${registryRel} 结构异常/损坏 → 跳过退役清理（不覆盖）`);
    return { removed: [], backup: null, error: 'registry-unreadable' };
  }
  const plan = planMcpRetire({ registry: cur, rules });
  if (!plan.remove.length) return { removed: [], backup: null, error: null, plan };
  const backupRel = `${registryRel}.retire-${utcStamp(now)}.bak`;
  try {
    fs.copyFileSync(file, path.join(root, backupRel));    // 回退路径：没备份成功就不动原文件
  } catch (e) {
    log(`[maintenance] MCP 注册表备份失败，已放弃本次退役（原文件未动）：${(e && e.message) || e}`);
    return { removed: [], backup: null, error: 'backup-failed', plan };
  }
  const drop = new Set(plan.removeIndexes);
  const keptServers = cur[registryKey].filter((_, i) => !drop.has(i));
  writeFileAtomic(file, JSON.stringify({ ...cur, [registryKey]: keptServers }, null, 2) + '\n', modeOf(file));
  return { removed: plan.remove, backup: backupRel, error: null, plan };
}

/* ==================== 启动期编排 ==================== */

/**
 * 启动维护入口（main.js 在 seedIfNeeded 之后调用）：
 *  - 清单缺失 → 不动（播种未发生，交回 seed）
 *  - legacy   → 只登记（把当前出厂全量写入清单）、不复制、不备份
 *  - 同版本   → 零写入（不做哈希，启动不变慢）
 *  - 版本变化 → 备份 → top-up（只补缺失）→ 并入注册表 → 写清单
 * 任何单点失败都只记日志、不 throw（启动不能被维护流程打断）。
 */
function onStartup({ root, defaultsDir, version = null, log = () => {}, now = new Date(), keep = BACKUP_KEEP } = {}) {
  if (!root) return { action: 'none', reason: 'no-root' };
  const read = readSeedManifest(root);
  if (read.state === 'missing') {
    log(`[maintenance] 未发现出厂清单 ${SENTINEL}：播种尚未发生，跳过升级维护`);
    return { action: 'none', reason: 'no-manifest', state: read.state };
  }
  const scan = scanDefaults(defaultsDir);
  if (!scan.ok) {
    log(`[maintenance] 未找到出厂默认目录（${defaultsDir}），跳过升级维护`);
    return { action: 'none', reason: 'no-defaults', state: read.state };
  }

  const registryFile = path.join(root, 'work/data/skills-registry.json');
  const userRegistry = readJson(registryFile);
  const superseded = supersededSkills(scan.registries);
  const suspiciousEmpty = read.state === 'normal' && Object.keys(read.manifest.files).length === 0 && scan.files.length > 0;
  const legacy = read.state === 'legacy' || suspiciousEmpty;

  let manifest = read.manifest;
  let fromVersion = manifest.version;
  let backup = null;
  let notDelivered = [];

  // ---------- 历史 MCP 退役清理（数据驱动 + 指纹双条件；同版本也执行，无命中则零写入）----------
  const mcpRules = readMcpRetirementRules(defaultsDir);
  let mcpRetired = [];
  let mcpRetireBackup = null;
  let mcpRetireError = null;
  if (mcpRules.ok && mcpRules.retirements.length) {
    try {
      const res = applyMcpRetire({ root, rules: mcpRules, now, log });
      mcpRetired = res.removed;
      mcpRetireBackup = res.backup;
      mcpRetireError = res.error;
      if (mcpRetired.length) {
        log(`[maintenance] 历史 MCP 退役清理：移除 ${mcpRetired.length} 条`
          + `（${mcpRetired.map((x) => x.name).join('、')}）→ 已整份备份 ${mcpRetireBackup}`);
        for (const x of mcpRetired) {
          if (x.replacement) log(`[maintenance]   · ${x.name} → 替代：${String(x.replacement).replace(/\s+/g, ' ').slice(0, 120)}`);
        }
      }
      const mism = (res.plan && res.plan.nameMatchedButFingerprintMismatch) || [];
      if (mism.length) {
        log(`[maintenance] MCP 同名但命令/URL 指纹不符 → 不动（防误删用户自加条目）：${fmtList(mism.map((x) => x.name))}`);
      }
    } catch (e) {
      mcpRetireError = (e && e.message) || String(e);
      log(`[maintenance] MCP 退役清理失败（不影响启动）：${mcpRetireError}`);
    }
  } else if (mcpRules.ok) {
    log(`[maintenance] MCP 退役清单为空或缺少指纹：跳过清理（${mcpRules.file}）`);
  }

  if (legacy) {
    // legacy 迁移（冻结后修订）：仍然"不复制用户可能删过的文件"，但用注册表区分"本代新增技能"：
    //  - 已存在 → 登记出厂基线（不复制；后续版本按规则 1/2 覆盖或保留）
    //  - 缺失 + 出厂技能且用户注册表无此 id → **不登记** → 交给本轮 top-up 按"本代新增"补齐（修"新技能补不上"）
    //  - 缺失 + 其它（用户删过的角色/全局文件、或注册表已知技能）→ 登记 → 不复活
    const present = new Set(existingOf(root, scan.files));
    const userSkillIds = new Set((((userRegistry || {}).skills) || []).map((x) => x && x.id).filter(Boolean));
    const files = {};
    for (const f of scan.files) {
      if (f.kind === 'registry') continue;
      const sid = skillIdOf(f.rel);
      if (sid && superseded.has(sid)) continue;                       // 退役技能不登记、不投递
      if (present.has(f.rel)) { files[f.rel] = f.sha256; continue; }
      if (sid && !userSkillIds.has(sid)) { notDelivered.push(f.rel); continue; }
      files[f.rel] = f.sha256;
    }
    writeSeedManifest(root, { version, at: now.toISOString(), files });
    manifest = { version: version || null, at: now.toISOString(), files };
    const absent = Object.keys(files).filter((rel) => !present.has(rel));
    log(`[maintenance] ${read.state === 'legacy' ? '旧版哨兵' : '空清单'}已升级为 JSON 清单：登记 ${Object.keys(files).length} 个出厂文件`
      + `（不复制用户可能删过的内容）`);
    if (absent.length) {
      log(`[maintenance] 本次未补的出厂文件 ${absent.length} 个（本机缺失 → 保守登记、不复活）：${fmtList(absent)}`);
    }
    if (notDelivered.length) {
      log(`[maintenance] 识别出"本代新增的出厂技能"${notDelivered.length} 个文件（用户注册表无对应条目）→ 本轮按新增补齐：${fmtList(notDelivered)}`);
    }
  } else {
    const up = planUpgrade({ version, manifest: read.manifest });
    if (!up.needed) {
      if (!mcpRetired.length) {
        return { action: 'none', reason: 'same-version', state: read.state, from: up.from, to: up.to, mcpRetired: [] };
      }
      // 同版本但清理了历史 MCP：只写"这次清理"的状态（其余零写入），保证可见且可诊断
      writeMaintenanceStatus(root, {
        at: now.toISOString(), action: 'mcp-retire', from: up.from, to: up.to,
        mcpRetired, mcpRetiredBackup: mcpRetireBackup, mcpRetireError,
      });
      return { action: 'mcp-retire', state: read.state, from: up.from, to: up.to, mcpRetired, mcpRetireBackup, mcpRetireError };
    }
    fromVersion = up.from;
    backup = up.hasPriorVersion
      ? backupBeforeUpgrade({ root, fromVersion: up.from, toVersion: up.to, now, keep, log })
      : null;
  }

  // ---------- 本地哈希（只算"需要判定"的文件，控制开销） ----------
  const presentRels = existingOf(root, scan.files);
  const presentSet = new Set(presentRels);
  const shipped = manifest.files || {};
  const localHashes = {};
  for (const f of scan.files) {
    if (f.kind === 'registry') continue;
    if (!presentSet.has(f.rel)) continue;
    if (shipped[f.rel] && shipped[f.rel] !== f.sha256) localHashes[f.rel] = hashFile(path.join(root, f.rel));   // 出厂变了 → 判定改没改
  }

  // ---------- 规则 5：技能退役（先退役，腾出 id 与目录） ----------
  const dirFiles = new Map();
  for (const id of superseded.keys()) dirFiles.set(id, localSkillFiles(root, id));
  for (const [, filesOfId] of dirFiles) {
    for (const rel of filesOfId) if (localHashes[rel] === undefined) localHashes[rel] = hashFile(path.join(root, rel));
  }
  const retirePlan = planRetire({ manifest, registry: userRegistry, factoryRegistry: scan.registries, localHashes, dirFiles });
  const retireResult = (retirePlan.retire.length || retirePlan.conflicts.length)
    ? applyRetire({ root, plan: retirePlan, now, log })
    : { backupName: null, backupDir: null, moved: [], removedEntries: [], failed: [] };

  // ---------- 规则 1-4：top-up（覆盖 / 保留+记录 / 不复活 / 补齐） ----------
  const plan = planTopUp({
    defaults: scan.files,
    manifest,
    existing: existingOf(root, scan.files),      // 退役后再算（被移走的目录不再算"存在"）
    registry: readJson(registryFile),
    factoryRegistry: scan.registries,
    localHashes,
  });

  // ① 注册表先并入（技能文件必须在条目就位后才落盘，否则就是孤儿）
  let mergeError = null;
  let added = [];
  if (plan.registryAdd.length) {
    // ⚠️ 这里必须传 ROOT 相对路径：mergeRegistryEntries 内部会 path.join(root, destRel)
    const r = mergeRegistryEntries(root, 'work/data/skills-registry.json', 'skills', plan.registryAdd, log);
    if (r.error) mergeError = r.error;
    else added = r.added;
  }

  const srcByRel = new Map(scan.files.map((f) => [f.rel, f.src]));
  const registered = { ...plan.registered };
  const copied = [];
  const overwritten = [];
  const failed = [];

  // ② 规则 1：未被改过 → 用新出厂文件覆盖
  for (const rel of plan.overwrite) {
    const src = srcByRel.get(rel);
    const dest = path.join(root, rel);
    try {
      if (!src) throw new Error('出厂源文件未找到');
      fs.copyFileSync(src, dest);
      overwritten.push(rel);
    } catch (e) {
      failed.push(rel);
      delete registered[rel];
      log(`[maintenance] 覆盖失败 ${rel}：${(e && e.message) || e}`);
    }
  }

  // ③ 规则 4：补齐本代新增（逐文件失败只记日志，绝不中断）
  const skipIds = new Set(plan.registryAdd.map((e) => e.id));
  const copyList = mergeError
    ? plan.copy.filter((rel) => { const id = skillIdOf(rel); return !id || !skipIds.has(id) || added.includes(id); })
    : plan.copy;
  for (const rel of copyList) {
    const src = srcByRel.get(rel);
    const dest = path.join(root, rel);
    try {
      if (!src) throw new Error('出厂源文件未找到');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied.push(rel);
    } catch (e) {
      failed.push(rel);
      delete registered[rel];   // 没落盘就不登记：下次启动仍可补
      log(`[maintenance] 补文件失败 ${rel}：${(e && e.message) || e}`);
    }
  }
  for (const rel of plan.copy) {
    const id = skillIdOf(rel);
    if (mergeError && id && skipIds.has(id) && !added.includes(id)) delete registered[rel];
  }

  writeSeedManifest(root, { version, at: now.toISOString(), files: registered });

  const action = legacy ? 'legacy-migrate' : 'top-up';
  const to = version || null;
  log(`[maintenance] ${legacy ? 'legacy 迁移 + 本轮补齐' : `升级维护 ${fromVersion} → ${to}`}：`
    + `覆盖 ${overwritten.length} 个（未被改过的出厂文件取新版）`
    + `，补齐 ${copied.length} 个`
    + `${plan.keepModified.length ? `，保留用户改动 ${plan.keepModified.length} 个` : ''}`
    + `${plan.skippedUserDeleted.length ? `，尊重用户删除 ${plan.skippedUserDeleted.length} 个` : ''}`
    + `${added.length ? `，新增技能注册表条目 ${added.length} 条` : ''}`
    + `${retireResult.moved.length ? `，退役技能 ${retireResult.moved.length} 个` : ''}`
    + `${mcpRetired.length ? `，退役历史 MCP ${mcpRetired.length} 条` : ''}`
    + `${backup ? `，备份 → ${backup.name}` : ''}`);
  if (overwritten.length) log(`[maintenance] 已用新版覆盖（本机内容与出厂记录一致，即未被改过）：${fmtList(overwritten)}`);
  if (plan.keepModified.length) {
    log(`[maintenance] ⚠️ 出厂有新版本、但本机内容与记录不一致（视作用户改过）→ 保留用户版本并记录，不覆盖：${fmtList(plan.keepModified.map((x) => x.rel))}`);
  }
  if (plan.skippedUserDeleted.length) log(`[maintenance] 已删除过、本次不复活的文件：${fmtList(plan.skippedUserDeleted)}`);
  if (plan.skippedUnregistered.length) {
    log(`[maintenance] 跳过 ${plan.skippedUnregistered.length} 个"注册表无条目"的出厂文件（不制造孤儿）：${fmtList(plan.skippedUnregistered)}`);
  }
  if (retireResult.moved.length) {
    log(`[maintenance] 已退役技能（整目录移入 work/backups/${retireResult.backupName}/，注册表条目已移除）：`
      + `${retireResult.moved.map((x) => `${x.id}（${x.files} 个文件）`).join('、')}`);
  }
  if (retirePlan.conflicts.length) {
    log(`[maintenance] ⚠️ 应退役但被用户改过 → 保留并记冲突：${retirePlan.conflicts.map((c) => `${c.id}（${c.modified.length} 个文件改动，supersededBy=${c.supersededBy}）`).join('、')}`);
  }

  // 孤儿**条目**（注册表有条目、目录不存在）：可能是用户手动删了目录。不自动复活、也不自动清理
  // 用户注册表，但必须**可见**（否则界面显示一个装不起来的技能却查不到原因）。
  const regAfter = readJson(registryFile);
  const orphanEntries = ((((regAfter || {}).skills) || [])).filter((x) => x && x.id && !fs.existsSync(path.join(root, 'skills', x.id))).map((x) => x.id);
  if (orphanEntries.length) {
    log(`[maintenance] ⚠️ 注册表条目无对应目录（可能被手动删除）：${fmtList(orphanEntries)}——不自动复活、不自动清理`);
  }

  const status = {
    at: now.toISOString(), action, from: fromVersion || null, to,
    backup: backup ? backup.name : null,
    registered: Object.keys(registered).length,
    copied: copied.length,          // 兼容既有断言/消费方：数字计数
    copiedFiles: copied,            // 明细
    overwritten,
    upgradeAvailable: plan.upgradeAvailable,                       // 规则 2：出厂有新版但用户改过（可见，不静默）
    retired: retireResult.moved.map((x) => ({ id: x.id, files: x.files })),
    retiredBackup: retireResult.backupName,
    registryRemoved: retireResult.removedEntries,
    retireConflicts: retirePlan.conflicts.map((c) => ({ id: c.id, supersededBy: c.supersededBy, modified: c.modified.length })),
    notDelivered,                                                  // legacy：本机缺失但保守登记（不复活）的清单
    failed: failed.concat(retireResult.failed.map((f) => `retire:${f.id}`)),
    registryAdded: added,
    skippedUserDeleted: plan.skippedUserDeleted,
    skippedUnregistered: plan.skippedUnregistered,
    skippedSuperseded: plan.skippedSuperseded.length,
    orphanEntries,
    mcpRetired,                        // 历史 MCP 退役：移除了哪些（name/id/reason/replacement）
    mcpRetiredBackup: mcpRetireBackup,
    mcpRetireError,
  };
  writeMaintenanceStatus(root, status);

  return {
    action, state: read.state, from: fromVersion || null, to,
    backup, copied, overwritten, failed,
    keepModified: plan.keepModified, upgradeAvailable: plan.upgradeAvailable,
    retired: status.retired, retiredBackup: retireResult.backupName, retireConflicts: status.retireConflicts,
    registryAdded: added, registryRemoved: retireResult.removedEntries, mergeError,
    notDelivered,
    orphanEntries,
    mcpRetired, mcpRetireBackup, mcpRetireError,
    skippedExisting: plan.skippedExisting.length,
    skippedUserDeleted: plan.skippedUserDeleted,
    skippedUnregistered: plan.skippedUnregistered,
    skippedSuperseded: plan.skippedSuperseded,
    registered: Object.keys(registered).length,
  };
}

/* ==================== D 阶段：崩溃报告 / 启动预检 / 恢复重置 ==================== */

const CRASH_KEEP = 10;                          // 崩溃报告保留份数（DSH 口径）
const MAX_STDERR_TAIL = 64 * 1024;              // 引擎 stderr 尾部硬上限（64KiB：有界，禁止无界累积）
const MAX_ERROR_CONSOLE = 32 * 1024;            // 最近 error 级 console 上限
const CRASH_SOURCES = ['main', 'renderer', 'engine', 'child'];
const CRASH_RE = /^crash-\d{8}T\d{6}Z-(main|renderer|engine|child)\.log$/;
const RUNTIME_REL = 'work/data/runtime.json';   // 运行期信息（诊断导出读它拿日志目录/版本/是否打包）
// vendor 引擎二进制体积下限：v0.24.12 供应链事故里二进制只剩 67KB，落位后必须能看出来
const ENGINE_MIN_BYTES = 10 * 1024 * 1024;

/** 有界字节环形缓冲（引擎 stderr / error console 共用）：超过 maxBytes 从头部丢弃，绝不无界增长 */
function createByteRing(maxBytes = MAX_STDERR_TAIL) {
  const max = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : MAX_STDERR_TAIL;
  let chunks = [];
  let total = 0;
  return {
    max,
    push(chunk) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk == null ? '' : chunk), 'utf8');
      if (!b.length) return total;
      chunks.push(b);
      total += b.length;
      while (total > max && chunks.length) {
        const first = chunks[0];
        const over = total - max;
        if (first.length <= over) { chunks.shift(); total -= first.length; }
        else { chunks[0] = first.subarray(over); total -= over; }
      }
      return total;
    },
    bytes() { return total; },
    text() { return Buffer.concat(chunks, total).toString('utf8'); },
  };
}

/** 取尾部 ≤maxBytes 的内容：先跳过被截断的多字节字符，再尽量对齐行边界（不产生半行/乱码） */
function clipTail(text, maxBytes = MAX_STDERR_TAIL) {
  const s = String(text == null ? '' : text);
  const b = Buffer.from(s, 'utf8');
  if (b.length <= maxBytes) return s;
  let cut = b.subarray(b.length - maxBytes);
  let i = 0;
  while (i < cut.length && (cut[i] & 0xc0) === 0x80) i++;   // UTF-8 续字节 10xxxxxx → 丢掉半截字符
  cut = cut.subarray(i);
  const nl = cut.indexOf(0x0a);
  if (nl >= 0 && nl < cut.length - 1) cut = cut.subarray(nl + 1);
  return cut.toString('utf8');
}

/** 崩溃报告文件名：crash-<UTC>-<source>.log（source 归一为 main|renderer|engine|child） */
function crashFilename(source, now = new Date()) {
  const s = CRASH_SOURCES.includes(String(source)) ? String(source) : 'main';
  return `crash-${utcStamp(now)}-${s}.log`;
}

/** 目录内崩溃报告列表（按名字升序；UTC 后缀字典序即时间序） */
function listCrashReports(logDir) {
  let names = [];
  try { names = fs.readdirSync(logDir).filter((n) => CRASH_RE.test(n)); } catch { return []; }
  names.sort();
  return names.map((name) => ({ name, path: path.join(logDir, name) }));
}

function latestCrashReport(logDir) {
  const all = listCrashReports(logDir);
  return all.length ? all[all.length - 1] : null;
}

/** 只保留最近 keep 份（默认 10） */
function trimCrashReports({ logDir, keep = CRASH_KEEP, log = () => {} } = {}) {
  const n = Number.isFinite(keep) && keep > 0 ? Math.floor(keep) : CRASH_KEEP;
  const all = listCrashReports(logDir);
  const removed = [];
  while (all.length > n) {
    const victim = all.shift();
    try { fs.rmSync(victim.path, { force: true }); removed.push(victim.name); }
    catch (e) { log(`[crash] 清理旧崩溃报告失败 ${victim.name}：${(e && e.message) || e}`); }
  }
  return { kept: all.map((x) => x.name), removed };
}

function safeJson(v) { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
function readText(file) {
  try { return { text: fs.readFileSync(file, 'utf8'), error: null }; }
  catch (e) { return { text: null, error: (e && e.message) || String(e) }; }
}
function isJson(text) { try { JSON.parse(text); return true; } catch { return false; } }
function jsonError(text) { try { JSON.parse(text); return null; } catch (e) { return (e && e.message) || String(e); } }

/**
 * 写崩溃报告（薄 IO，**绝不 throw**：目录不可用/写盘失败只记日志，不影响启动与运行）。
 * 内容：来源/版本/是否打包/ROOT/日志目录/原因/详情 + 最近 error 级 console + 引擎 stderr 尾部。
 */
function writeCrashReport({
  logDir, source = 'main', version = null, packaged = null, root = null, now = new Date(),
  reason = '', details = null, stderrTail = '', errorConsole = '', extra = null, log = () => {},
} = {}) {
  try {
    if (!logDir) return { ok: false, error: 'no-log-dir' };
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    const L = [];
    L.push('=== ROSE 崩溃报告 ===');
    L.push('来源          ' + source);
    L.push('时间          ' + now.toISOString());
    L.push('应用版本      ' + (version || 'unknown'));
    L.push('是否打包      ' + String(packaged));
    L.push('ROOT          ' + (root || '(未解析)'));
    L.push('日志目录      ' + logDir);
    L.push('进程          pid=' + process.pid + ' ' + process.platform + '/' + process.arch);
    L.push('Electron/Node ' + (process.versions.electron || '-') + ' / ' + process.version);
    L.push('');
    L.push('--- 原因 ---');
    L.push(String(reason || '(未提供)'));
    if (details) { L.push(''); L.push('--- 详情 ---'); L.push(typeof details === 'string' ? details : safeJson(details)); }
    if (extra) { L.push(''); L.push('--- 补充 ---'); L.push(typeof extra === 'string' ? extra : safeJson(extra)); }
    L.push('');
    L.push(`--- 最近 error 级 console（尾部 ≤${Math.round(MAX_ERROR_CONSOLE / 1024)}KiB）---`);
    L.push(clipTail(errorConsole, MAX_ERROR_CONSOLE) || '（本次运行无 error 级 console 输出）');
    L.push('');
    L.push(`--- 引擎 stderr 尾部（≤${Math.round(MAX_STDERR_TAIL / 1024)}KiB）---`);
    L.push(clipTail(stderrTail, MAX_STDERR_TAIL) || '（本次运行无引擎 stderr 输出）');
    const name = crashFilename(source, now);
    const file = writeFileAtomic(path.join(logDir, name), L.join('\n') + '\n', 0o600);
    trimCrashReports({ logDir, log });           // 每次写盘后顺带裁剪，长会话也不会堆积
    let bytes = null;
    try { bytes = fs.statSync(file).size; } catch { /* 忽略 */ }
    return { ok: true, name, path: file, bytes };
  } catch (e) {
    try { log(`[crash] 崩溃报告写入失败（不影响启动/运行）：${(e && e.message) || e}`); } catch { /* 忽略 */ }
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** 诊断导出用的崩溃摘要（最近一份路径 + 份数 + 日志目录） */
function crashSummary(logDir) {
  const latest = latestCrashReport(logDir);
  return { logDir: logDir || null, count: listCrashReports(logDir).length, latest };
}

/**
 * 运行子进程并带超时（**永不 reject**，只 resolve 结果对象）：
 * 用于"产品自身的数据准备"这类不该拖垮启动的后台动作（G 阶段 D4 的随包运行时预装）。
 *  - 成功/失败/ENOENT/超时/同步抛错 一律 resolve：{ok, code, signal, timedOut, durationMs, stdout, stderr, error}
 *  - 超时先 SIGTERM，2s 后 SIGKILL 并强制 resolve（绝不让调用方挂住）
 *  - stdout/stderr 有界（尾部 ≤maxTail）：防止异常子进程刷爆内存
 */
function runChildWithTimeout({ spawn, command, args = [], env = null, cwd = null, timeoutMs = 300000, killGraceMs = 2000, maxTail = 8192, onSpawn = null, log = () => {} } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child = null;
    let done = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    let timer = null;
    const finish = (patch) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({
        command, args, timedOut, durationMs: Date.now() - started,
        stdout: clipTail(stdout, maxTail), stderr: clipTail(stderr, maxTail),
        ...patch,
      });
    };
    try {
      child = spawn(command, args, { env: env || process.env, cwd: cwd || undefined, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return finish({ ok: false, error: (e && e.message) || String(e) });
    }
    if (typeof onSpawn === 'function') { try { onSpawn(child); } catch { /* 忽略 */ } }
    try {
      if (child.stdout && child.stdout.on) child.stdout.on('data', (d) => { stdout += String(d); if (stdout.length > maxTail * 4) stdout = stdout.slice(-maxTail * 2); });
      if (child.stderr && child.stderr.on) child.stderr.on('data', (d) => { stderr += String(d); if (stderr.length > maxTail * 4) stderr = stderr.slice(-maxTail * 2); });
      child.on('error', (err) => finish({ ok: false, error: (err && err.message) || String(err) }));
      child.on('exit', (code, signal) => finish({ ok: !timedOut && code === 0, code, signal: signal || null }));
    } catch (e) {
      return finish({ ok: false, error: (e && e.message) || String(e) });
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        log(`[maintenance] 子进程超时（${timeoutMs}ms），终止：${command}`);
        try { child.kill('SIGTERM'); } catch { /* 忽略 */ }
        const kh = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* 忽略 */ }
          finish({ ok: false, code: null, signal: 'SIGKILL', error: 'timeout' });   // 即便没有 exit 事件也必须放行
        }, Number.isFinite(killGraceMs) && killGraceMs >= 0 ? killGraceMs : 2000);
      }, timeoutMs);
    }
  });
}

/** 运行期信息（诊断导出读它拿日志目录/版本/是否打包，取代"日志路径只有主进程知道"的断点） */
function writeRuntimeInfo(root, info) {
  try {
    return writeFileAtomic(path.join(root, RUNTIME_REL), JSON.stringify({ ...(info || {}), at: new Date().toISOString() }, null, 2) + '\n', 0o600);
  } catch { return null; }
}
/** 合并式更新运行期信息（原子 + 0o600）：后台动作（如运行时预装）完成后回填，不覆盖既有字段 */
function patchRuntimeInfo(root, patch) {
  try {
    const cur = readRuntimeInfo(root) || {};
    const next = { ...cur, ...(patch || {}), at: new Date().toISOString() };
    return writeFileAtomic(path.join(root, RUNTIME_REL), JSON.stringify(next, null, 2) + '\n', 0o600);
  } catch { return null; }
}

/** 运行时就绪摘要（供 nativeSupport / 诊断导出暴露"随包运行时是否就绪"） */
function runtimeReadiness(root) {
  const rt = readRuntimeInfo(root) || {};
  const office = (rt && rt.officeRuntime) || null;
  return {
    logsDir: rt.logsDir || null,
    packaged: rt.packaged === undefined ? null : rt.packaged,
    version: rt.version || null,
    officeRuntime: office
      ? { state: office.state || null, ready: !!office.ready, dir: office.dir || null, runtimeId: office.runtimeId || null, action: office.action || null, at: office.at || null, durationMs: office.durationMs === undefined ? null : office.durationMs, error: office.error || null }
      : { state: 'unknown', ready: false, dir: null, runtimeId: null, action: null, at: null, durationMs: null, error: null },
  };
}

function readRuntimeInfo(root) {
  const j = readJson(path.join(root, RUNTIME_REL));
  return (j && typeof j === 'object') ? j : null;
}

/** 是否该为"渲染进程退出"写崩溃报告（退出期/被 SIGTERM 终止的销毁不算崩溃） */
function shouldReportRendererGone(details = {}) {
  const reason = String((details && details.reason) || '');
  if (reason === 'clean-exit') return false;
  if (reason === 'killed' && details.exitCode === 15) return false;   // SIGTERM 主动终止（forcefullyCrashRenderer 是 exitCode=2，仍上报）
  return true;
}

/** 是否该为"其它 Electron 子进程退出"写崩溃报告（Renderer 由专用入口接管，避免一份崩溃两份报告） */
function shouldReportChildGone(details = {}) {
  const d = details || {};
  if (d.type === 'Renderer') return false;
  const reason = String(d.reason || '');
  if (reason === 'clean-exit') return false;
  if (reason === 'killed') return false;   // GPU/Utility 被主动终止（退出期销毁、我们自己 kill）不算崩溃
  return true;
}

/** 是否 codex app-server 的 spawn（只认这一种，不误伤 MCP/其它子进程） */
function isCodexSpawn(command, args) {
  const cmd = String(command == null ? '' : command);
  return /codex/i.test(cmd) && Array.isArray(args) && args.some((a) => String(a) === 'app-server');
}

/**
 * 是否"异常退出"（决定要不要写崩溃报告）：
 *  - SIGTERM 不报：闲置回收/LRU/退出清理都是我们主动 kill 的，属正常
 *  - SIGKILL/SIGSEGV/SIGABRT/SIGBUS/SIGILL/SIGFPE 报
 *  - 无信号时非零退出码报；0 / null 不报
 */
function isAbnormalEngineExit(code, signal) {
  if (signal) return ['SIGKILL', 'SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGILL', 'SIGFPE'].includes(String(signal));
  if (code === null || code === undefined) return false;
  return Number(code) !== 0;
}

/**
 * 包装 child_process.spawn，只给 codex app-server 挂 exit 监视。
 * 约束（Lead 裁定）：纯 pass-through —— 不改参数、不吞事件、异常原样抛出、返回值原样。
 * @returns {{installed:boolean, restore:()=>void}}
 */
function watchEngineSpawns({ cp = require('child_process'), onAbnormalExit, isTarget = isCodexSpawn, isAbnormal = isAbnormalEngineExit, log = () => {} } = {}) {
  const orig = cp.spawn;
  if (typeof orig !== 'function' || orig.__roseWatched) return { installed: false, restore() {} };
  const wrapped = function (...args) {
    const child = orig.apply(this, args);        // 异常原样抛出、返回值原样返回
    try {
      if (isTarget(args[0], args[1]) && child && typeof child.on === 'function') {
        child.on('exit', (code, signal) => {
          try { if (isAbnormal(code, signal)) onAbnormalExit({ code, signal, command: args[0], args: args[1] }); }
          catch (e) { log(`[crash] 引擎退出处理失败：${(e && e.message) || e}`); }
        });
      }
    } catch (e) { log(`[crash] 引擎进程监视挂载失败（不影响进程本身）：${(e && e.message) || e}`); }
    return child;
  };
  wrapped.__roseWatched = true;
  cp.spawn = wrapped;
  return { installed: true, restore() { cp.spawn = orig; } };
}

/* ---------- 启动前预检（**只读**：只检测、绝不动磁盘） ---------- */

function mkFault(severity, kind, file, detail, suggestion) {
  return { severity, kind, path: file, detail, suggestion };
}

/**
 * p 是否位于 root 之内（两侧都归一化后再比）。
 * ⚠️ 不能直接 `p.startsWith(root)`：ROSE_ROOT 可能是非规范串（如 `/tmp/x//y`、`$PWD/./data`），
 * 而 fault.path 经 path.join 已归一化 → 前缀不匹配会把所有故障误判为"未解决"，重置空转（缺陷 D1）。
 */
function isUnder(root, p) {
  if (!root || !p) return false;
  const rel = path.relative(path.resolve(String(root)), path.resolve(String(p)));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 启动前只读预检。覆盖 verifier 复现的 C1/C3：
 *  - settings.json 缺失/损坏（会让 services.init 抛错）
 *  - sessions.json 损坏（services.js:838 sweepExpiredSessions 曾因 {__corrupt:true} TypeError 崩启动）
 *  - sessions.json 已被服务层隔离（.corrupt-<ts> 存在且索引缺失）——这一态要能被识别
 *  - vendor 引擎二进制缺失/体积异常（供应链事故教训）
 *  - 线程映射 / 注册表损坏（warn 级：不阻塞启动，但必须可见）
 * @returns {{ok:boolean, faults:Array}}
 */
function preflight({ root, engineBin = null, defaultsDir = null } = {}) {
  const faults = [];
  if (!root) {
    return { ok: false, faults: [mkFault('fatal', 'no-root', '(未解析)', 'ROOT 未解析', '检查 ROSE_ROOT 与启动方式（开发态用 npm start）')] };
  }
  const dataDir = path.join(root, 'work', 'data');
  const settings = path.join(root, 'roles', '_global', 'settings.json');
  const example = path.join(root, 'roles', '_global', 'settings.example.json');

  if (!fs.existsSync(settings)) {
    faults.push(mkFault('fatal', 'settings-missing', settings,
      fs.existsSync(example) ? '缺少 settings.json（同目录有 settings.example.json 模板）' : '缺少 settings.json 且没有模板可重建',
      '选择「备份数据后重置」可从模板重建（模型配置需重新填写）'));
  } else {
    const t = readText(settings);
    if (t.error) {
      faults.push(mkFault('fatal', 'settings-corrupt', settings, 'settings.json 读取失败：' + t.error, '选择「备份数据后重置」（损坏文件会隔离为 .corrupt-<ts>）'));
    } else {
      const je = jsonError(t.text);
      if (je) faults.push(mkFault('fatal', 'settings-corrupt', settings, 'settings.json JSON 解析失败：' + je, '选择「备份数据后重置」（损坏文件会隔离为 .corrupt-<ts>）'));
    }
  }

  const sessions = path.join(dataDir, 'sessions.json');
  if (fs.existsSync(sessions)) {
    const t = readText(sessions);
    const je = t.error ? t.error : jsonError(t.text);
    if (je) {
      faults.push(mkFault('fatal', 'sessions-corrupt', sessions,
        '会话索引 JSON 解析失败：' + je + '（继续启动会在服务层抛 TypeError，表现为"启动失败"）',
        '选择「备份数据后重置」：索引隔离为 .corrupt-<ts>，随后自动重建空索引'));
    }
  } else {
    let quarantined = [];
    try { quarantined = fs.readdirSync(dataDir).filter((n) => /^sessions\.json\.corrupt-/.test(n)); } catch { /* 目录不存在 */ }
    if (quarantined.length) {
      faults.push(mkFault('warn', 'sessions-quarantined', sessions,
        `会话索引已被隔离（${quarantined.slice(-3).join('、')}），当前无索引，服务层会重建空索引`,
        '先「重启」即可；若重启后仍报错，再「备份数据后重置」'));
    }
  }

  const threads = path.join(dataDir, 'engine-threads.json');
  if (fs.existsSync(threads)) {
    const t = readText(threads);
    const je = t.error ? t.error : jsonError(t.text);
    if (je) faults.push(mkFault('fatal', 'threads-corrupt', threads, '会话→线程映射 JSON 解析失败：' + je, '选择「备份数据后重置」（隔离损坏映射，会话会重建线程）'));
  }

  for (const [rel, label] of [['work/data/skills-registry.json', '技能注册表'], ['work/data/mcp-registry.json', 'MCP 注册表']]) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const t = readText(file);
    const je = t.error ? t.error : jsonError(t.text);
    if (je) faults.push(mkFault('warn', 'registry-corrupt', file, `${label} JSON 解析失败：${je}（界面会显示为空）`, '选择「备份数据后重置」可从出厂注册表重建（自建条目需重新导入）'));
  }

  if (!engineBin) {
    faults.push(mkFault('fatal', 'engine-missing', '(未解析到路径)', '引擎二进制路径未解析', '运行 `npm run setup`（或重新安装应用）后再启动'));
  } else {
    let st = null;
    try { st = fs.statSync(engineBin); } catch { st = null; }
    if (!st || !st.isFile()) {
      faults.push(mkFault('fatal', 'engine-missing', engineBin,
        `引擎二进制不存在（期望路径：${engineBin}；实际大小：无）`,
        '运行 `npm run setup` 重新下载随包引擎，或重新安装应用'));
    } else if (/[\\/]vendor[\\/]/.test(engineBin) && st.size < ENGINE_MIN_BYTES) {
      faults.push(mkFault('fatal', 'engine-truncated', engineBin,
        `引擎二进制体积异常（实际 ${st.size} 字节，应 ≥ ${ENGINE_MIN_BYTES} 字节）——曾出现下载半成品覆盖可用二进制的事故`,
        '运行 `npm run setup` 重新下载（会校验哈希/体积）后再启动'));
    }
  }

  if (defaultsDir && !fs.existsSync(defaultsDir)) {
    faults.push(mkFault('warn', 'defaults-missing', defaultsDir, '出厂默认目录不存在（升级维护会跳过）', '检查安装包/开发目录是否完整'));
  }
  return { ok: !faults.some((f) => f.severity === 'fatal'), faults };
}

/** 故障列表 → 可读文本（报告/对话框共用） */
function describeFaults(faults) {
  const arr = faults || [];
  if (!arr.length) return '（无）';
  return arr.map((f, i) => {
    const tag = f.severity === 'fatal' ? '【致命】' : '【警告】';
    return `${i + 1}. ${tag}${f.detail || f.kind}\n   路径：${f.path}\n   建议：${f.suggestion || '（无）'}`;
  }).join('\n');
}

/**
 * 重置计划（纯函数）：**只清损坏项**，不动其它数据。
 *  - 损坏文件 → 隔离为 `<file>.corrupt-<ts>`（与 services.js 既有命名约定一致）
 *  - settings.json 损坏/缺失 → 从 roles/_global/settings.example.json 重建模板
 *  - 注册表损坏 → 从出场注册表重建（自建条目需重新导入，已在建议里写明）
 *  - 引擎二进制缺失等无法在数据层修复的 → unresolved（对话框据此提示）
 */
function planReset({ root, faults = [], defaultsDir = null, now = new Date(), stamp = null } = {}) {
  const ts = stamp === null ? Date.now() : stamp;
  const quarantine = [];
  const regenerate = [];
  const unresolved = [];
  const skipped = [];
  const exampleRel = 'roles/_global/settings.example.json';
  for (const f of faults || []) {
    const p = f && f.path;
    if (!p || !isUnder(root, p)) { if (f) unresolved.push(f); continue; }
    if (f.kind === 'settings-corrupt') {
      quarantine.push({ from: p, to: `${p}.corrupt-${ts}`, expect: f.kind });
      regenerate.push({ from: path.join(root, exampleRel), to: p });
    } else if (f.kind === 'settings-missing') {
      regenerate.push({ from: path.join(root, exampleRel), to: p });
    } else if (f.kind === 'sessions-corrupt' || f.kind === 'threads-corrupt') {
      quarantine.push({ from: p, to: `${p}.corrupt-${ts}`, expect: f.kind });
    } else if (f.kind === 'registry-corrupt') {
      quarantine.push({ from: p, to: `${p}.corrupt-${ts}`, expect: f.kind });
      if (defaultsDir) regenerate.push({ from: path.join(defaultsDir, 'registries', path.basename(p)), to: p });
      else unresolved.push({ ...f, detail: (f.detail || '') + '（未提供出厂目录，无法重建注册表）' });
    } else if (f.kind === 'sessions-quarantined') {
      skipped.push({ kind: f.kind, path: p, why: '索引已在隔离状态，服务层会重建空索引（无需重置）' });
    } else {
      unresolved.push(f);
    }
  }
  return { quarantine, regenerate, unresolved, skipped, at: now.toISOString() };
}

/** 隔离前的二次确认：文件此刻仍然是"坏"的（防止重复执行把已重建好的文件再挪走） */
function stillFaulty(kind, file) {
  let exists = false;
  try { exists = fs.existsSync(file); } catch { return false; }
  if (!exists) return false;
  if (String(kind || '').endsWith('-corrupt')) {
    const t = readText(file);
    return !!t.error || !isJson(t.text);
  }
  return true;
}

/** 执行重置（薄 IO，**绝不 throw**：逐项失败只记录）；幂等：重复执行不会重复隔离/覆盖 */
function applyReset({ root, plan, log = () => {} } = {}) {
  const moved = [];
  const regenerated = [];
  const skippedMissing = [];
  const skippedHealthy = [];
  const failed = [];
  for (const op of (plan && plan.quarantine) || []) {
    try {
      if (!fs.existsSync(op.from)) { skippedMissing.push(op.from); continue; }            // 幂等：已隔离过
      if (op.expect && !stillFaulty(op.expect, op.from)) { skippedHealthy.push(op.from); continue; }  // 幂等：已重建好，别再挪
      let to = op.to;
      let i = 1;
      while (fs.existsSync(to)) to = `${op.to}-${++i}`;                                   // 不覆盖既有隔离文件
      fs.renameSync(op.from, to);
      moved.push({ from: op.from, to });
    } catch (e) {
      failed.push({ op: 'quarantine', path: op.from, error: (e && e.message) || String(e) });
      log(`[reset] 隔离失败 ${op.from}：${(e && e.message) || e}`);
    }
  }
  for (const op of (plan && plan.regenerate) || []) {
    try {
      if (fs.existsSync(op.to)) { skippedMissing.push(op.to); continue; }        // 幂等：不覆盖已恢复的文件
      if (!fs.existsSync(op.from)) { failed.push({ op: 'regenerate', path: op.to, error: '模板不存在：' + op.from }); continue; }
      fs.mkdirSync(path.dirname(op.to), { recursive: true });
      fs.copyFileSync(op.from, op.to);
      regenerated.push(op.to);
    } catch (e) {
      failed.push({ op: 'regenerate', path: op.to, error: (e && e.message) || String(e) });
      log(`[reset] 重建失败 ${op.to}：${(e && e.message) || e}`);
    }
  }
  void root;
  return { moved, regenerated, skippedMissing, skippedHealthy, failed };
}

module.exports = {
  SENTINEL, BACKUP_DIRNAME, BACKUP_KEEP, BACKUP_SETS, BACKUP_EXCLUDE, REGISTRY_DESTS, REGISTRY_KEYS, STATUS_REL,
  sha256, scanDir, scanDefaults, existingOf, utcStamp, safeVersion, skillIdOf,
  readSeedManifest, writeSeedManifest, writeFileAtomic, copyTreeNonDestructive, copyTreeExcluding,
  planTopUp, planUpgrade, mergeRegistryEntries, removeRegistryEntries,
  hashFile, hashOf, supersededSkills, localSkillFiles, planRetire, applyRetire,
  RETIRED_MCP_REL, readMcpRetirementRules, mcpFingerprintMatches, planMcpRetire, applyMcpRetire,
  listBackups, pruneBackups, backupBeforeUpgrade, backupRoot,
  readMaintenanceStatus, writeMaintenanceStatus,
  onStartup,
  // D 阶段：崩溃报告 / 预检 / 重置
  CRASH_KEEP, MAX_STDERR_TAIL, MAX_ERROR_CONSOLE, CRASH_SOURCES, RUNTIME_REL, ENGINE_MIN_BYTES,
  createByteRing, clipTail, crashFilename, listCrashReports, latestCrashReport, trimCrashReports,
  writeCrashReport, crashSummary, writeRuntimeInfo, readRuntimeInfo, patchRuntimeInfo, runtimeReadiness,
  runChildWithTimeout,
  isCodexSpawn, isAbnormalEngineExit, watchEngineSpawns,
  shouldReportRendererGone, shouldReportChildGone,
  preflight, describeFaults, planReset, applyReset, isUnder,
};
