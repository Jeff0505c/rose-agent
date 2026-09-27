'use strict';
/**
 * 出厂默认数据播种（v0.21.4 语义：只种一次）
 *
 * 规则：
 *  - 仅「首次安装」把随包 defaults/ 复制到 ROOT（打包态 = userData/store）。
 *  - 以 ROOT/.seeded 哨兵判定：哨兵存在 → 永不再次播种（不复制/不合并/不覆盖/不补增）。
 *  - 用户删除的角色/技能/MCP 不会被补回。
 *  - 已知代价：新版本新增的默认项不会自动进入已有用户（仅全新安装可见）。
 *
 * 复制为非破坏式：只创建缺失目标，已存在一律跳过（绝不覆盖用户数据）。
 */
const fs = require('fs');
const path = require('path');
const maintenance = require('./maintenance');

// 出厂清单文件（v0.25.1 起为 JSON：{version, at, files:{相对路径:sha256}}；旧版是纯文本时间戳 → legacy）
const SENTINEL = maintenance.SENTINEL;

// 非破坏复制：src 目录树中「目标不存在」的文件才复制；返回复制文件数
// skipAbs：可选，给出"要跳过的绝对路径"判定（用于不播种已退役的出厂技能目录）
function copyMissing(src, dest, skipSrc) {
  let n = 0;
  let st;
  if (typeof skipSrc === 'function' && skipSrc(src)) return 0;
  try { st = fs.statSync(src); } catch { return 0; }
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) n += copyMissing(path.join(src, name), path.join(dest, name), skipSrc);
  } else if (st.isFile()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      n++;
    }
  }
  return n;
}

/**
 * @param {{root:string, defaultsDir:string, version?:string, log?:(m:string)=>void}} opts
 * @returns {{seeded:boolean, reason?:string, copied?:number}}
 */
function seedIfNeeded({ root, defaultsDir, version = null, log = () => {} }) {
  if (!root) return { seeded: false, reason: 'no-root' };
  const sentinel = path.join(root, SENTINEL);
  if (fs.existsSync(sentinel)) return { seeded: false, reason: 'already-seeded' };
  if (!defaultsDir || !fs.existsSync(defaultsDir)) {
    log(`[seed] 未找到出厂默认目录（${defaultsDir}），跳过播种`);
    return { seeded: false, reason: 'no-defaults' };
  }

  let copied = 0;
  // 出厂注册表里的"被新版取代/退役"技能（数据驱动：条目上的 supersededBy / retired）：
  // 首次安装就不该装它们（否则一装就是"文件在、与新版并存"的坏路径）。
  let superseded = new Map();
  try { superseded = maintenance.supersededSkills(maintenance.scanDefaults(defaultsDir).registries); }
  catch { superseded = new Map(); }
  const skipSkillSrc = (abs) => {
    if (!superseded.size) return false;
    const rel = path.relative(path.join(defaultsDir, 'skills'), abs);
    if (!rel || rel.startsWith('..')) return false;
    const id = rel.split(path.sep)[0];
    return superseded.has(id);
  };
  // 角色（含 _global 模板）：按文件补缺即可（角色以目录扫描为准，无独立注册表）
  copied += copyMissing(path.join(defaultsDir, 'roles'), path.join(root, 'roles'));

  // 技能以注册表（work/data/skills-registry.json）为唯一事实源，UI/引擎都读它。
  // 仅当注册表缺失（真正的首次安装）时才复制技能文件——否则会出现
  // 「文件在 skills/、注册表却没有」的孤儿，界面上看不到（v0.22.2 修复）。
  const dataDir = path.join(root, 'work', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const freshSkills = !fs.existsSync(path.join(dataDir, 'skills-registry.json'));
  if (freshSkills) {
    copied += copyMissing(path.join(defaultsDir, 'skills'), path.join(root, 'skills'), skipSkillSrc);
    if (superseded.size) log(`[seed] 跳过已退役的出厂技能（supersededBy）：${[...superseded.keys()].join('、')}`);
  }

  // 默认注册表 → ROOT/work/data/
  for (const f of ['skills-registry.json', 'mcp-registry.json']) {
    const src = path.join(defaultsDir, 'registries', f);
    const dest = path.join(dataDir, f);
    if (!fs.existsSync(src) || fs.existsSync(dest)) continue;
    // 技能注册表：剥离已退役条目（唯一事实源不得留下"有条目、没文件"的反向孤儿）
    if (f === 'skills-registry.json' && superseded.size) {
      try {
        const reg = JSON.parse(fs.readFileSync(src, 'utf8'));
        if (reg && Array.isArray(reg.skills)) {
          reg.skills = reg.skills.filter((e) => !(e && superseded.has(e.id)));
          fs.writeFileSync(dest, JSON.stringify(reg, null, 2) + '\n');
          copied++;
          continue;
        }
      } catch { /* 解析失败 → 回落为逐字复制（保持既有行为） */ }
    }
    fs.copyFileSync(src, dest);
    copied++;
  }

  // settings.json 首次由模板生成
  const example = path.join(root, 'roles', '_global', 'settings.example.json');
  const settings = path.join(root, 'roles', '_global', 'settings.json');
  if (fs.existsSync(example) && !fs.existsSync(settings)) { fs.copyFileSync(example, settings); copied++; }

  // 写清单（升级为 JSON：版本 + 全部出厂文件 sha256）。首次安装 = 全部出厂文件都已投递，
  // 因此这里把**出厂全量**登记进去：此后用户删掉任何一项都不会被 top-up 复活。
  // ⚠️ 扫描/写入失败时**回落到旧版纯文本哨兵**（legacy → 只登记不复制），
  // 绝不写"空 files 的 JSON 清单"——那会让下次启动把用户删过的文件当成"新版新增"补回。
  try {
    const scan = maintenance.scanDefaults(defaultsDir);
    if (!scan.ok) throw new Error('出厂目录扫描失败');
    const files = {};
    for (const f of scan.files) {
      if (f.kind === 'registry') continue;
      const id = maintenance.skillIdOf(f.rel);
      if (id && superseded.has(id)) continue;     // 退役技能不进清单（未来若取消退役，按"新增"投递）
      files[f.rel] = f.sha256;
    }
    maintenance.writeSeedManifest(root, { version, at: new Date().toISOString(), files });
  } catch (e) {
    try { fs.writeFileSync(sentinel, new Date().toISOString() + '\n'); } catch { /* 下面统一记日志 */ }
    log(`[seed] 出厂清单写入失败，已回落为旧版哨兵（后续按 legacy 处理）：${(e && e.message) || e}`);
  }
  log(`[seed] 首次安装：已播种出厂默认数据（${copied} 个文件）→ ${root}`);
  return { seeded: true, copied };
}

module.exports = { seedIfNeeded, SENTINEL };
