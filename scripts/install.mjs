#!/usr/bin/env node
/**
 * 一键安装依赖 —— 自动选择 npm registry 与 Electron 下载通道（含镜像回退）
 *
 *   node scripts/install.mjs                 # 安装 <cwd>/APP 的依赖（在仓库根目录执行）
 *   node scripts/install.mjs --app ../APP    # 指定应用目录
 *   node scripts/install.mjs --dry-run       # 只探测并打印将使用的通道，不安装
 *   node scripts/install.mjs --force-mirror  # 直接走国内镜像（不探测官方）
 *   node scripts/install.mjs --direct        # 直连下载 Electron（curl 进度条+续传，绕开 npm 下载器）
 *   node scripts/install.mjs --registry <url> --mirror <url>
 *
 * 为什么需要它：Electron 的二进制不在 npm registry 里，而是安装时从 GitHub Releases 下载；
 * 这一步在国内网络经常超时，标准解法是设 ELECTRON_MIRROR 环境变量——但
 *   · `npm config set ELECTRON_MIRROR` 会报 "not a valid npm option"（不是 npm 的配置键）；
 *   · 用户也不该知道这些细节。
 * 所以这里做三件事：**探测连通性 → 选通道 → 装完校验二进制真的落位**。
 *
 * 探测策略：官方（registry.npmjs.org / github.com）可达就用官方；不可达则回退 npmmirror；
 * 两者都不可达时明确报错并给出可手工执行的命令，而不是让 npm 抛一堆 ECONNRESET。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const NPM_OFFICIAL = 'https://registry.npmjs.org/';
const NPM_MIRROR = 'https://registry.npmmirror.com/';
// Electron 下载基址：镜像用 <base><version>/<file>；官方用 releases/download/v<version>/<file>
const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
const ELECTRON_OFFICIAL_BASE = 'https://github.com/electron/electron/releases/download/v';
// 只用于探测连通性的“一定存在”的旧版本（不参与安装，安装用 package.json 里的版本）
const PROBE_VERSION = '22.0.0';
const BUILDER_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';
const MIN_NODE = [22, 15, 0];

/**
 * 通道选择（纯函数，便于离线测试）
 * @param {{npmOfficial:boolean, npmMirror:boolean, electronOfficial:boolean, electronMirror:boolean}} reach
 */
export function chooseChannels(reach) {
  const registry = reach.npmOfficial ? NPM_OFFICIAL : (reach.npmMirror ? NPM_MIRROR : null);
  const electronMirror = reach.electronOfficial ? '' : (reach.electronMirror ? ELECTRON_MIRROR : null);
  const notes = [];
  if (registry === NPM_MIRROR) notes.push('npm registry 官方不可达 → 改用 npmmirror');
  if (registry === null) notes.push('npm registry 官方与镜像都不可达');
  if (electronMirror === ELECTRON_MIRROR) notes.push('Electron 官方下载不可达 → 改用 npmmirror 镜像');
  if (electronMirror === null) notes.push('Electron 官方与镜像都不可达');
  return { registry, electronMirror, builderMirror: electronMirror ? BUILDER_MIRROR : '', notes };
}

/** Node 版本是否满足要求 */
export function nodeTooOld(version, min = MIN_NODE) {
  const v = String(version).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i++) {
    if ((v[i] || 0) > min[i]) return false;
    if ((v[i] || 0) < min[i]) return true;
  }
  return false;
}

async function reachable(url, timeoutMs = 8000) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    return r.ok || r.status === 405 || r.status === 403;   // 部分站点不支持 HEAD，视为可达
  } catch { return false; }
}

/**
 * 探测 Electron **资产下载**通道：用 Range 请求真拉 1KB。
 * 只探首页/HEAD 是不够的——曾经出现过「页面可达、资产下载超时」的情况（release 会 302 到对象存储），
 * 那正是用户在 `npm install` 卡住的真实原因。206/200 才算通。
 */
async function probeElectronDownload(base, timeoutMs = 15000) {
  const file = process.platform === 'darwin'
    ? `electron-v${PROBE_VERSION}-darwin-arm64.zip`
    : `electron-v${PROBE_VERSION}-win32-x64.zip`;
  const url = `${base}${PROBE_VERSION}/${file}`;
  try {
    const r = await fetch(url, {
      method: 'GET', redirect: 'follow',
      headers: { Range: 'bytes=0-1023' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    try { if (r.body) await r.body.cancel(); } catch { /* 忽略 */ }
    return r.ok || r.status === 206;
  } catch { return false; }
}

/** electron-builder 产物里 electron 二进制的落位（用于校验） */
function electronBinaryPath(appDir) {
  const rel = process.platform === 'win32'
    ? ['dist', 'electron.exe']
    : process.platform === 'darwin'
      ? ['dist', 'Electron.app']
      : ['dist', 'electron'];
  return path.join(appDir, 'node_modules', 'electron', ...rel);
}

/* ---------------- 直连下载模式（绕开 npm 内置下载器） ---------------- */

/** @electron/get 的缓存根目录 */
export function electronCacheDir() {
  if (process.env.electron_config_cache) return process.env.electron_config_cache;
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    return path.join(base, 'electron', 'Cache');
  }
  if (process.platform === 'darwin') return path.join(process.env.HOME || '', 'Library', 'Caches', 'electron');
  return path.join(process.env.HOME || '', '.cache', 'electron');
}

/**
 * 复刻 @electron/get 的缓存路径规则：<cacheRoot>/sha256(<URL 去掉文件名>)/<文件名>。
 * （依据 node_modules/@electron/get/dist/cjs/Cache.js#getCacheDirectory，已用真实缓存目录名验证）
 */
export function cachePathFor(downloadUrl, fileName, cacheRoot = electronCacheDir()) {
  const u = new URL(downloadUrl);
  const stripped = `${u.protocol}//${u.host}${path.posix.dirname(u.pathname)}`;
  const dir = crypto.createHash('sha256').update(stripped).digest('hex');
  return path.join(cacheRoot, dir, fileName);
}

/** electron 资产名（仅支持 macOS arm64 与 Windows x64，与 platform.js 的支持矩阵一致） */
export function electronAsset(version) {
  const plat = process.platform === 'darwin' ? 'darwin' : 'win32';
  const arch = process.platform === 'darwin' ? 'arm64' : 'x64';
  return `electron-v${version}-${plat}-${arch}.zip`;
}

/** zip 是否完整：看尾部是否有中央目录结束记录（PK\x05\x06），用于识别下载中断的半截文件 */
export function looksCompleteZip(file) {
  try {
    const size = fs.statSync(file).size;
    if (size < 1024 * 1024) return false;
    const fd = fs.openSync(file, 'r');
    const tailLen = Math.min(66000, size);
    const buf = Buffer.alloc(tailLen);
    fs.readSync(fd, buf, 0, tailLen, size - tailLen);
    fs.closeSync(fd);
    return buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  } catch { return false; }
}

/** 解开 electron.zip 到目标目录（Windows 用 PowerShell，mac 用 unzip） */
function extractZip(zip, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  let r;
  if (process.platform === 'win32') {
    const ps = `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`;
    r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { stdio: 'inherit', windowsHide: true });
  } else {
    r = spawnSync('unzip', ['-o', '-q', zip, '-d', dest], { stdio: 'inherit' });
  }
  return r.status === 0;
}

/**
 * 直连下载 + 手工落位 Electron 二进制。
 * 为什么需要：npm 内置下载器在弱网/被墙时既没有进度也不重试，表现为「一直等待」。
 * 这里用 curl（进度条 + 断点续传 + 重试）取 zip → 自己解压 → 自己写 path.txt/version，
 * 顺带把 zip 种回 @electron/get 的缓存（后续 npm install 会直接命中，不再下载）。
 */
async function directInstall(a, chosen) {
  const appPkg = JSON.parse(fs.readFileSync(path.join(a.appDir, 'package.json'), 'utf8'));
  const wantRange = (appPkg.devDependencies && appPkg.devDependencies.electron) || '';

  console.log('\n[直连模式] 第一步：安装 npm 包（跳过 postinstall 里的二进制下载）');
  const npmArgs = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (chosen.registry !== NPM_OFFICIAL) npmArgs.push('--registry', chosen.registry);
  const r1 = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, {
    cwd: a.appDir, stdio: 'inherit',
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
    shell: process.platform === 'win32',
  });
  if (r1.status !== 0) { console.error('\n✗ npm install --ignore-scripts 失败（退出码 ' + r1.status + '）'); process.exit(r1.status || 1); }

  const pkgPath = path.join(a.appDir, 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error(`\n✗ 没装上 electron 包（缺少 ${pkgPath}）——npm registry 是否有问题？可用 --registry <url> 指定。`);
    process.exit(1);
  }
  const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  const asset = electronAsset(version);
  const mirrorBase = chosen.electronMirror || ELECTRON_MIRROR;
  const mirrorUrl = `${mirrorBase}${version}/${asset}`;
  const officialUrl = `${ELECTRON_OFFICIAL_BASE}${version}/${asset}`;
  const cacheRoot = electronCacheDir();

  console.log(`\n[直连模式] 第二步：准备 Electron ${version}（package.json 要求 ${wantRange || '未声明'}）`);
  console.log(`  资产：${asset}`);
  console.log(`  缓存目录：${cacheRoot}`);

  // 1) 缓存（两个 URL 形态都查：之前用官方装的会命中官方 hash 目录）
  let zip = [officialUrl, mirrorUrl].map((u) => cachePathFor(u, asset, cacheRoot)).find(looksCompleteZip);
  // 1b) 仓库内自带的 zip（离线可用：<目录>/electron-zip/<asset>）
  if (!zip) {
    const bundled = [path.join(a.appDir, '..', 'electron-zip', asset), path.join(a.appDir, 'electron-zip', asset)]
      .find(looksCompleteZip);
    if (bundled) {
      zip = bundled;
      console.log(`  ✓ 使用副本自带安装包：${bundled}（${(fs.statSync(bundled).size / 1048576).toFixed(1)} MB，无需联网）`);
    }
  }
  if (zip) {
    if (!zip.startsWith(cacheRoot)) console.log(`  ✓ 命中缓存：${zip}（${(fs.statSync(zip).size / 1048576).toFixed(1)} MB）`);
  } else {
    const tmp = path.join(cacheRoot, asset + '.part');
    fs.mkdirSync(cacheRoot, { recursive: true });
    for (const url of [mirrorUrl, officialUrl]) {
      console.log(`  下载：${url}`);
      spawnSync('curl', ['-L', '--http1.1', '--fail', '--progress-bar',
        '--retry', '10', '--retry-all-errors', '--retry-delay', '3', '--connect-timeout', '30',
        '-C', '-', '-o', tmp, url], { stdio: 'inherit' });
      if (looksCompleteZip(tmp)) { zip = tmp; break; }
      console.log('  ✗ 该来源未拿到完整文件，换下一个来源重试…');
    }
    if (!zip) {
      console.error('\n✗ Electron 下载失败。可指定其它镜像：node scripts/install.mjs --direct --mirror <url>');
      console.error(`  期望布局：<mirror>/${version}/${asset}`);
      process.exit(1);
    }
    console.log(`  ✓ 下载完成（${(fs.statSync(zip).size / 1048576).toFixed(1)} MB）`);
  }

  // 2) 解压 + 关键标记文件（electron 的 install.js 靠 dist/version 判断"已装好"，
  //    有它之后即使再跑一次普通 npm install 也不会重新下载）
  console.log('\n[直连模式] 第三步：解压到 node_modules/electron/dist');
  const dist = path.join(a.appDir, 'node_modules', 'electron', 'dist');
  if (!extractZip(zip, dist)) { console.error('\n✗ 解压失败：' + zip); process.exit(1); }
  fs.writeFileSync(path.join(a.appDir, 'node_modules', 'electron', 'path.txt'),
    process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron');
  const verFile = path.join(dist, 'version');
  if (!fs.existsSync(verFile)) fs.writeFileSync(verFile, version + '\n');

  // 3) 种回缓存（两个 URL 形态），让后续普通 npm install 直接命中、不再联网下载
  for (const u of [mirrorUrl, officialUrl]) {
    const target = cachePathFor(u, asset, cacheRoot);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) fs.copyFileSync(zip, target);
    } catch { /* 种缓存失败不影响安装结果 */ }
  }
  if (zip.endsWith('.part')) { try { fs.unlinkSync(zip); } catch { /* 忽略 */ } }

  const bin = electronBinaryPath(a.appDir);
  if (!fs.existsSync(bin)) { console.error(`\n✗ 解压后仍找不到 ${bin}（zip 可能不完整）`); process.exit(1); }
  console.log(`  ✓ Electron 就位：${bin}`);
  console.log('\n[直连模式] 完成。下一步：npm start');
  if (process.platform === 'win32') {
    console.log('  提示：本模式跳过了所有 postinstall；若以后打包时报 electron-builder 缺二进制，执行 npm rebuild');
  }
}

function parseArgs(argv) {
  const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  return {
    appDir: path.resolve(opt('app', path.join(REPO, 'APP'))),
    registry: opt('registry', ''),
    mirror: opt('mirror', ''),
    dryRun: argv.includes('--dry-run'),
    direct: argv.includes('--direct'),
    forceMirror: argv.includes('--force-mirror'),
    forceOfficial: argv.includes('--official'),
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  console.log('=== ROSE 依赖安装 ===');
  console.log(`Node       ${process.version}`);
  console.log(`应用目录   ${a.appDir}`);

  if (!fs.existsSync(path.join(a.appDir, 'package.json'))) {
    console.error(`\n✗ 该目录没有 package.json：${a.appDir}`);
    console.error('  如果你在仓库根目录执行，请确认 APP/ 子目录存在；或用 --app <应用目录> 指定。');
    process.exit(1);
  }
  if (nodeTooOld(process.version)) {
    console.error(`\n✗ Node ${process.version} 过旧：请升级到 ${MIN_NODE.join('.')} 或更高（推荐 24 LTS）。`);
    process.exit(1);
  }

  /* ---- 1. 探测通道 ---- */
  let chosen;
  if (a.registry && a.mirror !== undefined && a.forceOfficial) {
    chosen = { registry: a.registry, electronMirror: a.forceOfficial ? '' : a.mirror, builderMirror: '', notes: ['按命令行参数指定'] };
  } else if (a.forceMirror) {
    chosen = chooseChannels({ npmOfficial: false, npmMirror: true, electronOfficial: false, electronMirror: true });
    chosen.notes.unshift('按 --force-mirror 强制使用镜像');
  } else if (a.forceOfficial) {
    chosen = { registry: NPM_OFFICIAL, electronMirror: '', builderMirror: '', notes: ['按 --official 强制使用官方通道'] };
  } else {
    console.log('\n探测下载通道（含 1KB 实测下载）…');
    const [npmOfficial, npmMirror, electronOfficial, electronMirror] = await Promise.all([
      reachable(NPM_OFFICIAL + 'electron'),
      reachable(NPM_MIRROR + 'electron'),
      probeElectronDownload(ELECTRON_OFFICIAL_BASE),
      probeElectronDownload(ELECTRON_MIRROR),
    ]);
    console.log(`  registry.npmjs.org            ${npmOfficial ? '可用' : '不可用'}`);
    console.log(`  registry.npmmirror.com        ${npmMirror ? '可用' : '不可用'}`);
    console.log(`  Electron 官方 GitHub Releases  ${electronOfficial ? '可用' : '不可用'}`);
    console.log(`  Electron npmmirror 镜像        ${electronMirror ? '可用' : '不可用'}`);
    chosen = chooseChannels({ npmOfficial, npmMirror, electronOfficial, electronMirror });
  }
  if (a.registry) chosen.registry = a.registry;
  if (a.mirror) chosen.electronMirror = a.mirror;

  console.log('\n选择：');
  console.log(`  npm registry      ${chosen.registry || '(不可用)'}`);
  console.log(`  Electron 下载      ${chosen.electronMirror ? chosen.electronMirror + '（镜像）' : '官方 GitHub Releases'}`);
  for (const n of chosen.notes) console.log(`  · ${n}`);

  if (chosen.registry === null) {
    console.error('\n✗ npm registry 不可达（官方与镜像都不通）：请检查网络/代理后重试，或手工指定 --registry <url>。');
    process.exit(1);
  }
  if (chosen.electronMirror === null) {
    console.error('\n✗ Electron 下载通道不可达。可稍后重试，或手工指定 --mirror <url>（镜像布局：<mirror>/<版本>/electron-v<版本>-<平台>-<架构>.zip）。');
    process.exit(1);
  }
  if (a.dryRun) {
    console.log('\n（--dry-run：未执行安装）');
    return;
  }
  if (a.direct) {
    await directInstall(a, chosen);
    return;
  }

  /* ---- 2. 安装 ---- */
  const env = { ...process.env };
  if (chosen.electronMirror) env.ELECTRON_MIRROR = chosen.electronMirror;
  else delete env.ELECTRON_MIRROR;                     // 避免继承到上一次的镜像设置
  if (chosen.builderMirror) env.ELECTRON_BUILDER_BINARIES_MIRROR = chosen.builderMirror;

  const npmArgs = ['install', '--no-audit', '--no-fund'];
  if (chosen.registry !== NPM_OFFICIAL) npmArgs.push('--registry', chosen.registry);
  console.log(`\n执行：npm ${npmArgs.join(' ')}`);
  if (chosen.electronMirror) console.log(`      （环境变量 ELECTRON_MIRROR=${chosen.electronMirror}）`);
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, {
    cwd: a.appDir, stdio: 'inherit', env, shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error('\n✗ npm install 失败（退出码 ' + r.status + '）。');
    console.error('  常见原因与对策：');
    console.error(`    1) 若卡在 Electron 下载（无进度、长时间不动）→ 改用直连模式：node scripts/install.mjs --direct`);
    console.error(`       （curl 带进度条与断点续传，可指定 --mirror <url>）`);
    console.error(`    2) 代理/证书问题 → set HTTPS_PROXY=… 后重试（Windows PowerShell: $env:HTTPS_PROXY="http://host:port"）`);
    console.error(`    3) 清掉半成品后重来 → 删除 ${path.join(a.appDir, 'node_modules')} 再执行`);
    process.exit(r.status || 1);
  }

  /* ---- 3. 校验二进制真的落位（npm 成功 ≠ Electron 可用）---- */
  const bin = electronBinaryPath(a.appDir);
  if (!fs.existsSync(bin)) {
    console.error(`\n✗ 依赖已安装，但 Electron 二进制不在位：${bin}`);
    console.error('  说明 electron 的 postinstall 未完成下载。请重跑本脚本（会续传），或设镜像后重试：');
    console.error(`    Windows:  $env:ELECTRON_MIRROR="${ELECTRON_MIRROR}"`);
    console.error(`    macOS:    export ELECTRON_MIRROR="${ELECTRON_MIRROR}"`);
    process.exit(1);
  }
  const size = (() => { try { return fs.statSync(bin).size; } catch { return 0; } })();
  console.log(`\n✓ Electron 二进制就位：${bin}${size ? `（${(size / 1048576).toFixed(1)} MB）` : ''}`);
  console.log('\n下一步：npm start        （离线自检：npm run check / npm test）');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('✗ ' + ((e && e.message) || e)); process.exit(1); });
}
