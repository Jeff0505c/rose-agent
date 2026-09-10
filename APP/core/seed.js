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

const SENTINEL = '.seeded';

// 非破坏复制：src 目录树中「目标不存在」的文件才复制；返回复制文件数
function copyMissing(src, dest) {
  let n = 0;
  let st;
  try { st = fs.statSync(src); } catch { return 0; }
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) n += copyMissing(path.join(src, name), path.join(dest, name));
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
 * @param {{root:string, defaultsDir:string, log?:(m:string)=>void}} opts
 * @returns {{seeded:boolean, reason?:string, copied?:number}}
 */
function seedIfNeeded({ root, defaultsDir, log = () => {} }) {
  if (!root) return { seeded: false, reason: 'no-root' };
  const sentinel = path.join(root, SENTINEL);
  if (fs.existsSync(sentinel)) return { seeded: false, reason: 'already-seeded' };
  if (!defaultsDir || !fs.existsSync(defaultsDir)) {
    log(`[seed] 未找到出厂默认目录（${defaultsDir}），跳过播种`);
    return { seeded: false, reason: 'no-defaults' };
  }

  let copied = 0;
  // 角色（含 _global 模板）：按文件补缺即可（角色以目录扫描为准，无独立注册表）
  copied += copyMissing(path.join(defaultsDir, 'roles'), path.join(root, 'roles'));

  // 技能以注册表（work/data/skills-registry.json）为唯一事实源，UI/引擎都读它。
  // 仅当注册表缺失（真正的首次安装）时才复制技能文件——否则会出现
  // 「文件在 skills/、注册表却没有」的孤儿，界面上看不到（v0.22.2 修复）。
  const dataDir = path.join(root, 'work', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const freshSkills = !fs.existsSync(path.join(dataDir, 'skills-registry.json'));
  if (freshSkills) {
    copied += copyMissing(path.join(defaultsDir, 'skills'), path.join(root, 'skills'));
  }

  // 默认注册表 → ROOT/work/data/
  for (const f of ['skills-registry.json', 'mcp-registry.json']) {
    const src = path.join(defaultsDir, 'registries', f);
    const dest = path.join(dataDir, f);
    if (fs.existsSync(src) && !fs.existsSync(dest)) { fs.copyFileSync(src, dest); copied++; }
  }

  // settings.json 首次由模板生成
  const example = path.join(root, 'roles', '_global', 'settings.example.json');
  const settings = path.join(root, 'roles', '_global', 'settings.json');
  if (fs.existsSync(example) && !fs.existsSync(settings)) { fs.copyFileSync(example, settings); copied++; }

  // 写哨兵：此后永不再次播种
  try {
    fs.writeFileSync(sentinel, new Date().toISOString() + '\n');
  } catch (e) {
    log(`[seed] 哨兵写入失败：${e.message}`);
  }
  log(`[seed] 首次安装：已播种出厂默认数据（${copied} 个文件）→ ${root}`);
  return { seeded: true, copied };
}

module.exports = { seedIfNeeded, SENTINEL };
