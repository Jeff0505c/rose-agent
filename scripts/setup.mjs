#!/usr/bin/env node
/**
 * 一键准备运行资产（开源模型：git clone 之后执行一次）
 *
 *   npm run setup                 # 取当前平台的 codex 资产
 *   npm run setup -- --mirror <base>
 *
 * 做三件事：
 *   1. 校验平台受支持（macOS arm64 / Windows x64）
 *   2. 取 codex 资产 → APP/core/vendor/（含 SHA256 校验）
 *   3. 检查随包本地工具（tools/github-mcp-server）是否存在，缺失只提示不阻断
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fetchCodex } from './fetch-codex.mjs';

const require = createRequire(import.meta.url);
const platform = require('../APP/core/platform.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

(async () => {
  console.log('=== ROSE setup ===');
  console.log(`平台：${process.platform}/${process.arch}  Node ${process.version}`);

  if (!platform.isSupported()) {
    console.error(`\n✗ 不支持的平台/架构：${process.platform}/${process.arch}`);
    console.error('  本项目支持：macOS arm64、Windows x64');
    process.exit(2);
  }

  console.log('\n[1/2] 取 codex 运行资产');
  const r = await fetchCodex({ mirror: opt('mirror', ''), vendorDir: opt('vendor', ''), cacheDir: opt('cache', '') });

  console.log('\n[2/2] 检查随包本地工具');
  const toolName = 'github-mcp-server' + platform.toolsExt();
  const toolPath = path.join(REPO, 'tools', toolName);
  if (fs.existsSync(toolPath)) {
    console.log(`  ✓ tools/${toolName}`);
  } else {
    console.log(`  ⚠ 缺少 tools/${toolName}（仅影响「代码专家」的 github MCP 预设，可后补）`);
  }

  console.log('\n=== 完成 ===');
  console.log('下一步：');
  console.log('  npm start          # 开发运行（Electron）');
  console.log('  npm run dist       # 构建当前平台安装包');
  console.log('  npm run doctor     # 环境自检');
})().catch((e) => { console.error('\n✗ setup 失败：' + e.message); process.exit(1); });
