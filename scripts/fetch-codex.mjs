#!/usr/bin/env node
/**
 * 取 codex 运行资产（开源模型：仓库不分发二进制，首次 setup 时按平台拉取并校验）
 *
 *   node scripts/fetch-codex.mjs                        # 取当前平台
 *   node scripts/fetch-codex.mjs --target win32-x64     # 跨平台取（交叉打包 / 为另一平台准备资产）
 *   node scripts/fetch-codex.mjs --mirror https://your-mirror/codex
 *   node scripts/fetch-codex.mjs --cache <dir> --vendor <dir>
 *
 * 落位：APP/core/vendor/  ← 与 APP/core/engines.js 的查找路径一致
 *   - macOS : codex-aarch64-apple-darwin
 *   - Windows: codex.exe + codex-windows-sandbox-setup.exe + codex-command-runner.exe（必须同目录）
 *
 * 校验：优先用 scripts/codex-pin.json 的 pins；为空则 TOFU（打印 SHA256 供粘回锁定）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const platform = require('../APP/core/platform.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PIN_PATH = path.join(HERE, 'codex-pin.json');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

export function loadPin() { return JSON.parse(fs.readFileSync(PIN_PATH, 'utf8')); }

export function targetKey(plat = process.platform, arch = process.arch) {
  platform.assertSupported(plat, arch);
  return `${plat}-${arch}`;
}

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function httpGetText(url) {
  try {
    return execFileSync('curl', ['-sSL', '--fail', '--connect-timeout', '20', '--max-time', '60',
      '--retry', '2', '--retry-delay', '2', '-H', 'User-Agent: rose-setup',
      '-H', 'Accept: application/vnd.github+json', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`请求失败：${url}\n  ${(e.stderr || e.message || '').toString().slice(0, 200)}`);
  }
}

/**
 * 下载单个资产。两条通道，自动回退：
 *   1) 直连 release 下载地址（github.com → objects.githubusercontent.com）
 *   2) GitHub API 资产端点（api.github.com/repos/…/releases/assets/<id>，Accept: octet-stream）
 * 通道 2 的用处：github.com 在部分网络下不可达（连接超时/被墙），但 api.github.com 与
 * 对象存储可达——国内用户与 CI 都能因此少踩坑。**校验始终在下载之后由 verify() 负责**。
 */
function download(url, dest, ctx = {}) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  已缓存 ${path.basename(dest)}（${mb(fs.statSync(dest).size)}）`);
    return;
  }
  console.log(`  下载 ${path.basename(dest)}\n    ← ${url}`);
  try {
    execFileSync('curl', ['-sSL', '--fail', '--http1.1', '--retry', '5', '--retry-delay', '3', '--retry-all-errors',
      '--connect-timeout', '30', '-C', '-', '-o', dest, url], { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(`    ✓ ${mb(fs.statSync(dest).size)}`);
    return;
  } catch (e) {
    if (!ctx.pin || !ctx.asset) throw e;
    console.log('    直连失败 → 改用 GitHub API 资产通道重试');
  }
  // 通道 2：API 拿 asset id → octet-stream 下载（curl 会自动跟随到对象存储）
  const rel = JSON.parse(httpGetText(`https://api.github.com/repos/${ctx.pin.releaseRepo}/releases/tags/${ctx.pin.releaseTag}`));
  const asset = (rel.assets || []).find((a) => a.name === ctx.asset);
  if (!asset) throw new Error(`release ${ctx.pin.releaseTag} 中没有资产 ${ctx.asset}`);
  execFileSync('curl', ['-sSL', '--fail', '--http1.1', '--retry', '5', '--retry-delay', '3', '--retry-all-errors',
    '--connect-timeout', '30', '-H', 'Accept: application/octet-stream', '-H', 'User-Agent: rose-setup',
    '-o', dest, asset.url], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`    ✓ ${mb(fs.statSync(dest).size)}（经 API 通道）`);
}

function verify(name, file, pin) {
  const got = sha256File(file);
  const want = (pin.pins || {})[name];
  if (want) {
    if (want !== got) throw new Error(`SHA256 不匹配：${name}\n  期望 ${want}\n  实际 ${got}`);
    console.log('  ✓ SHA256 校验通过（pin）');
    return got;
  }
  console.log('  ⚠ 无 pin（TOFU）。请把下面这行加入 scripts/codex-pin.json 的 pins：');
  console.log(`      "${name}": "${got}"`);
  return got;
}

/**
 * 解压 .zst → Buffer。
 * 首选 Node 内置 zstd（node:zlib.zstdDecompressSync，需 Node ≥ 22.15 / 23.8）；
 * 老版本 Node 回退系统 `zstd` 命令行；两者都没有时给出可执行的解决建议，
 * 而不是抛出 "zstdDecompressSync is not a function" 这种看不懂的错。
 */
function zstdDecode(file) {
  const buf = fs.readFileSync(file);
  if (typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(buf);
  try {
    return execFileSync('zstd', ['-d', '-c', file], { maxBuffer: 1024 * 1024 * 1024 });
  } catch {
    throw new Error(
      `当前 Node ${process.version} 不支持内置 zstd 解压，且未找到 zstd 命令行。\n` +
      '  解决：升级到 Node ≥ 22.15（推荐 24 LTS），或安装 zstd（macOS: brew install zstd / Windows: winget install zstd）。'
    );
  }
}

/** 取当前平台资产并落位到 APP/core/vendor */
export async function fetchCodex({ mirror = '', vendorDir, cacheDir, target = '' } = {}) {
  const pin = loadPin();
  // target 允许 'win32-x64' / 'darwin-arm64'：在一台机器上准备另一平台的资产（交叉打包用）
  let key;
  if (target) {
    const [tp, ta] = String(target).split('-');
    key = targetKey(tp, ta);
  } else {
    key = targetKey();
  }
  const spec = pin.targets[key];
  const VENDOR = vendorDir || path.join(REPO, 'APP', 'core', 'vendor');
  const CACHE = cacheDir || path.join(REPO, '.cache', 'codex');
  fs.mkdirSync(VENDOR, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });

  const base = (mirror || pin.mirrorBase || '').replace(/\/+$/, '')
    ? `${(mirror || pin.mirrorBase).replace(/\/+$/, '')}/${pin.releaseTag}`
    : `https://github.com/${pin.releaseRepo}/releases/download/${pin.releaseTag}`;

  console.log(`codex ${pin.codexVersion} · target=${key}\n落位目录：${VENDOR}\n`);

  const results = [];
  for (const [asset, finalName] of Object.entries(spec.assets)) {
    console.log(`· ${asset} → ${finalName}`);
    const cached = path.join(CACHE, asset);
    download(`${base}/${asset}`, cached, { pin, asset });
    const hash = verify(asset, cached, pin);
    const raw = zstdDecode(cached);
    const dest = path.join(VENDOR, finalName);
    fs.writeFileSync(dest, raw);
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    console.log(`  → ${dest}（${mb(raw.length)}）`);
    results.push({ asset, finalName, sha256: hash, bytes: raw.length });
  }

  const missing = spec.required.filter((f) => !fs.existsSync(path.join(VENDOR, f)));
  console.log('\n— 自检 —');
  for (const f of spec.required) {
    const p = path.join(VENDOR, f);
    console.log(`  ${fs.existsSync(p) ? '✓' : '✗'} ${f}${fs.existsSync(p) ? '  ' + mb(fs.statSync(p).size) : ''}`);
  }
  if (missing.length) throw new Error(`缺少必需文件：${missing.join(', ')}`);
  if (key === 'win32-x64') console.log('  注：三件套必须同目录（否则沙箱执行失效，见 codex#32655/#30829）');
  return { key, vendor: VENDOR, files: results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchCodex({ mirror: opt('mirror', ''), vendorDir: opt('vendor', ''), cacheDir: opt('cache', ''), target: opt('target', '') })
    .then((r) => console.log(`\n完成：${r.files.length} 个文件 → ${r.vendor}`))
    .catch((e) => { console.error('\n错误：' + e.message); process.exit(1); });
}
