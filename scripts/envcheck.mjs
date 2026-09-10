#!/usr/bin/env node
/**
 * 命令行环境自检（与应用内「设置 → 环境与诊断」同一实现）：
 *
 *   node scripts/envcheck.mjs                          # 用仓库/开发态默认路径
 *   node scripts/envcheck.mjs --engine "C:\ja\codex.exe" --root "C:\ja\store" --codex-home "C:\ja\home"
 *
 * 退出码：有 fail 项 → 1。CI（win-probe）与开发者本机共用。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const envcheck = require('../APP/core/envcheck.js');
const platform = require('../APP/core/platform.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const engineBin = arg('engine', path.join(REPO, 'APP', 'core', 'vendor', platform.codexBinName() || 'codex'));
const root = arg('root', process.env.ROSE_ROOT || REPO);
const codexHome = arg('codex-home', process.env.ROSE_CODEX_HOME || path.join(REPO, 'APP', 'core', '.codex-home'));
const toolsDir = arg('tools', path.join(REPO, 'tools'));

const report = envcheck.runChecks({
  root, codexHome, engineBin, toolsDir,
  helperNames: platform.codexHelperNames(),
  sandbox: null,
  plat: process.platform,
  arch: process.arch,
});

console.log(envcheck.formatReport(report));
console.log(`\n（codex 二进制：${engineBin}）`);
process.exit(report.summary.fail ? 1 : 0);
