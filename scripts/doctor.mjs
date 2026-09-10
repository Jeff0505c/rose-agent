#!/usr/bin/env node
/**
 * 环境自检（开源贡献者排查用）：node scripts/doctor.mjs
 * 只读检查，不修改任何文件。
 *
 * 检查逻辑与应用内「设置 → 环境自检」共用 APP/core/envcheck.js，
 * 保证 CLI 与 GUI 结论一致（同一份规则，不做两套判断）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const platform = require('../APP/core/platform.js');
const envcheck = require('../APP/core/envcheck.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const ok = (b) => (b ? '✓' : '✗');
let problems = 0;

console.log('=== ROSE doctor ===');
console.log(`平台         ${process.platform}/${process.arch}`);

console.log('\n-- APP/core/vendor --');
const VENDOR = path.join(REPO, 'APP', 'core', 'vendor');
const expect = [platform.codexBinName(), ...platform.codexHelperNames()].filter(Boolean);
let engineBin = '';
for (const f of expect) {
  const p = path.join(VENDOR, f);
  if (fs.existsSync(p)) {
    const buf = fs.readFileSync(p);
    const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    console.log(`  ${ok(true)} ${f}  ${mb(buf.length)}  sha256:${sha}…`);
    if (f === platform.codexBinName()) engineBin = p;
  } else {
    console.log(`  ${ok(false)} ${f} 缺失 → 运行 npm run setup`);
    problems++;
  }
}

console.log('\n-- tools（可选） --');
const tool = path.join(REPO, 'tools', 'github-mcp-server' + platform.toolsExt());
console.log(`  ${ok(fs.existsSync(tool))} tools/github-mcp-server${platform.toolsExt()}`);

console.log('\n-- Electron --');
const appPkg = path.join(REPO, 'APP', 'package.json');
try {
  const pkg = JSON.parse(fs.readFileSync(appPkg, 'utf8'));
  console.log(`  version: ${pkg.version}`);
  console.log(`  electron: ${(pkg.devDependencies || {}).electron || '(未声明)'}`);
} catch (e) { console.log(`  ${ok(false)} 读取 APP/package.json 失败：${e.message}`); problems++; }
const nm = path.join(REPO, 'APP', 'node_modules', 'electron');
console.log(`  ${ok(fs.existsSync(nm))} APP/node_modules/electron${fs.existsSync(nm) ? '' : ' → 先执行 npm install（在 APP/ 下）'}`);

// 统一检查（与 GUI 同一实现）：ROOT/CODEX_HOME 用开发态默认（仓库根）
const report = envcheck.runChecks({
  root: process.env.ROSE_ROOT || REPO,
  codexHome: process.env.ROSE_CODEX_HOME || path.join(REPO, 'APP', 'core', '.codex-home'),
  engineBin: engineBin || path.join(VENDOR, platform.codexBinName() || 'codex'),
  helperNames: platform.codexHelperNames(),
  toolsDir: path.join(REPO, 'tools'),
  sandbox: null,
  plat: process.platform,
});
console.log('\n-- 环境自检（与 GUI 同源） --');
console.log(envcheck.formatReport(report).split('\n').slice(1).join('\n'));
problems += report.summary.fail;

if (platform.isWin() && report.summary.fail === 0) {
  console.log('\n  提示：沙箱初始化（会弹 UAC）在应用内「设置 → Windows 沙箱」执行，CLI 不代劳。');
}

console.log(`\n结果：${problems === 0 ? '✓ 环境就绪' : `✗ ${problems} 项待处理`}`);
process.exit(problems ? 1 : 0);
