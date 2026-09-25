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
import { execFileSync, spawnSync } from 'node:child_process';
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
export const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

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
const CURL_BASE = ['-sSL', '--fail', '--http1.1', '--retry', '5', '--retry-delay', '3', '--retry-all-errors',
  '--connect-timeout', '30'];

/**
 * 缓存信任规则：
 *   ① 有 pin → 必须 hash 命中；
 *   ② 无 pin（首次 TOFU）→ 只信"上次**完整下载**留下的 .ok 标记"（大小+hash 与文件一致）。
 * 关键点：**绝不因为"文件存在且非空"就当作缓存命中**——一次被中断的下载会留下半成品，
 * 旧实现每次都把它当缓存命中，于是解出 67KB 垃圾二进制写进 vendor，最终以
 * `spawn Unknown system error -88`（Mach-O 被截断）暴露，极难定位。
 */
export function cacheOk(file) {
  const mark = file + '.ok';
  if (!fs.existsSync(file) || !fs.existsSync(mark)) return false;
  try {
    const m = JSON.parse(fs.readFileSync(mark, 'utf8'));
    const st = fs.statSync(file);
    return m.size === st.size && sha256File(file) === m.sha256;
  } catch { return false; }
}

export function markOk(file) {
  try { fs.writeFileSync(file + '.ok', JSON.stringify({ size: fs.statSync(file).size, sha256: sha256File(file) })); } catch {}
}

export function trustedCache(file, name, pin) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return false;
  const want = (pin.pins || {})[name];
  if (want) { try { return sha256File(file) === want; } catch { return false; } }
  return cacheOk(file);
}

function download(url, dest, ctx = {}) {
  const name = path.basename(dest);
  const { pin, asset } = ctx;
  const want = (pin.pins || {})[asset];
  if (trustedCache(dest, asset, pin)) {
    console.log(`  已缓存${want ? '且 pin 校验通过' : '（上次完整下载）'} ${name}（${mb(fs.statSync(dest).size)}）`);
    return;
  }
  const partial = fs.existsSync(dest) && fs.statSync(dest).size > 0;
  if (partial) console.log(`  缓存不可信 ${name}（${mb(fs.statSync(dest).size)}）→ 重新获取`);

  const curl = (extra, label) => {
    console.log(`    ← ${label}${url ? ' ' + url : ''}`);
    execFileSync('curl', [...CURL_BASE, ...extra], { stdio: ['ignore', 'ignore', 'inherit'] });
  };
  const resume = () => curl(['-C', '-', '-o', dest, url], '续传');
  const fresh = () => { try { fs.rmSync(dest, { force: true }); } catch {} curl(['-o', dest, url], '下载'); };
  const viaApi = () => {
    const rel = JSON.parse(httpGetText(`https://api.github.com/repos/${pin.releaseRepo}/releases/tags/${pin.releaseTag}`));
    const a = (rel.assets || []).find((x) => x.name === asset);
    if (!a) throw new Error(`release ${pin.releaseTag} 中没有资产 ${asset}`);
    try { fs.rmSync(dest, { force: true }); } catch {}
    curl(['-H', 'Accept: application/octet-stream', '-H', 'User-Agent: rose-setup', '-o', dest, a.url], 'API 通道');
  };

  // 有 pin 时先续传（省流量，且 hash 会判真伪）；无 pin 时不续传——半个文件续出来的"完整文件"
  // 无从校验，宁可整份重下。
  const attempts = want
    ? (partial ? [['续传', resume], ['重新下载', fresh], ['API 通道', viaApi]] : [['直连下载', fresh], ['API 通道', viaApi]])
    : [['直连下载', fresh], ['API 通道', viaApi]];

  let lastErr = null;
  for (const [label, fn] of attempts) {
    try {
      fn();
      if (want) {
        const got = sha256File(dest);
        if (got !== want) { lastErr = new Error(`SHA256 不匹配（${label}后）：期望 ${want}，实际 ${got}`); console.log(`    ✗ ${label}后校验未通过，换下一条通道`); continue; }
      }
      // 注意：**不在这里**打 .ok。TOFU 场景必须在解压+体积+落位自检全部通过后才标记为"完整"，
      // 否则一段 HTML/半截字节会被永久信任（decode 每次都抛错，而提示让用户"重跑命令"→ 死循环）。
      console.log(`    ✓ ${label}完成（${mb(fs.statSync(dest).size)}）`);
      return;
    } catch (e) {
      lastErr = e;
      console.log(`    ✗ ${label}失败：${String((e && e.message) || e).split('\n')[0]}`);
    }
  }
  throw new Error(`无法取得可信的 ${asset}：${lastErr ? lastErr.message : '未知原因'}\n`
    + `  缓存文件：${dest}\n  可手动下载官方 release 的 .zst 放到该路径后重跑。`);
}

/**
 * SHA256 校验（导出以便离线自测）。有 pin 必须命中；无 pin 为 TOFU，打印可直接粘回 pin 文件的行。
 * @returns {{got:string, source:'pin'|'tofu'}}
 */
export function verifyHash(name, file, pins = {}) {
  const got = sha256File(file);
  const want = (pins || {})[name];
  if (want) {
    if (want !== got) throw new Error(`SHA256 不匹配：${name}\n  期望 ${want}\n  实际 ${got}`);
    console.log('  ✓ SHA256 校验通过（pin）');
    return { got, source: 'pin' };
  }
  console.log('  ⚠ 无 pin（TOFU）。请把下面这行加入 scripts/codex-pin.json 的 pins：');
  console.log(`      "${name}": "${got}"`);
  return { got, source: 'tofu' };
}

/** 解压结果体积下限（无期望值时的兜底）：真实 codex 二进制远大于 1MB */
export const MIN_DECOMPRESSED_BYTES = 1024 * 1024;
/**
 * 从 zstd 帧头读出**声明的**解压后大小（Frame_Content_Size）。
 * 这是通用的截断检测手段：被截断的文件，其帧头里的声明大小仍是原始值，而实际解出的字节数会变少。
 * 返回 null 表示该帧未声明大小（此时只能退回体积下限）。
 * 帧头布局：magic(4) + Frame_Header_Descriptor(1) + [Window_Descriptor?] + [Dictionary_ID?] + FCS
 */
export function zstdDeclaredSize(buf) {
  try {
    if (!buf || buf.length < 6) return null;
    if (buf.readUInt32LE(0) !== 0xFD2FB528) return null;
    const fhd = buf[4];
    const fcsFlag = fhd >> 6;          // 0/1/2/3 → 0/2/4/8 字节（single-segment 时 0 表示 1 字节）
    const single = (fhd >> 5) & 1;
    let off = 5;
    if (!single) off += 1;             // Window_Descriptor
    // Dictionary_ID 字段（bits 1-0）会插在 FCS 之前，这里做保守跳过
    const didFlag = fhd & 3;
    off += didFlag === 0 ? 0 : (1 << didFlag);   // 1→1B, 2→2B, 3→4B
    const len = fcsFlag === 0 ? (single ? 1 : 0) : (1 << fcsFlag);
    if (!len || off + len > buf.length) return null;
    if (len === 1) return buf.readUInt8(off);
    if (len === 2) return buf.readUInt16LE(off) + 256;   // 2 字节形态的基准偏移
    if (len === 4) return buf.readUInt32LE(off);
    return Number(buf.readBigUInt64LE(off));
  } catch { return null; }
}

/**
 * 体积校验。⚠️ **必须优先用 pin 里的期望字节数**：实测 Node 的 zstdDecompressSync 对**截断的帧
 * 不抛错**，只是安静地少解出一些字节（4MB 的帧截到 10%/50%/90% → 分别解出 0.4MB/2.0MB/3.8MB）。
 * 只靠 1MB 下限的话，一个被截掉一半的二进制会被静默写进 vendor（Windows 沙箱会静默失效）。
 */
export function assertSaneSize(asset, bytes, expected, declared) {
  if (typeof declared === 'number' && declared > 0 && bytes !== declared) {
    throw new Error(`${asset} 解压体积与帧头声明不符：声明 ${mb(declared)}，实际 ${mb(bytes)}（文件被截断）`);
  }
  if (typeof expected === 'number' && expected > 0) {
    if (bytes !== expected) {
      throw new Error(`${asset} 解压体积不符：期望 ${expected} 字节（${mb(expected)}），实际 ${mb(bytes)}`);
    }
    return;
  }
  if (bytes < MIN_DECOMPRESSED_BYTES) {
    throw new Error(`${asset} 解压结果异常（只有 ${mb(bytes)}，疑似缓存 .zst 不完整）`);
  }
}

/** 缓存不可信时连 .ok 完成标记一起清掉（否则下次仍会被 trustedCache 当"完整下载"信任 → 死循环） */
export function purgeCache(file) {
  try { fs.rmSync(file, { force: true }); } catch {}
  try { fs.rmSync(file + '.ok', { force: true }); } catch {}
}

/**
 * 原子落位：先写 `<dest>.part` 再 rename。**关键**：中断只会留下 .part，
 * 绝不会留下一个"存在但跑不起来"的二进制（旧实现直接 writeFileSync 覆盖，
 * 半成品会让引擎报 `spawn Unknown system error -88`）。
 */
export function placeBinary(vendorDir, finalName, buf) {
  fs.mkdirSync(vendorDir, { recursive: true });
  const dest = path.join(vendorDir, finalName);
  const part = dest + '.part';
  fs.writeFileSync(part, buf);
  if (process.platform !== 'win32') fs.chmodSync(part, 0o755);
  try {
    fs.renameSync(part, dest);
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch {}   // 不留 .part（会被 extraResources 打进安装包）
    throw new Error(`无法落位 ${finalName}：${(e && e.message) || e}\n`
      + '  若 ROSE 正在运行，请先完全退出（Windows 上运行中的 exe 无法被覆盖）后重试。');
  }
  return dest;
}

/** 同目录必需文件断言（Windows 三件套必须并列，否则沙箱执行失效） */
export function assertColocated(vendorDir, names) {
  const missing = names.filter((n) => { try { return !fs.existsSync(path.join(vendorDir, n)); } catch { return true; } });
  return { ok: missing.length === 0, missing };
}

/**
 * 落位后自检：**真跑一次** `--version`。体积校验挡不住"文件完整但内容不对/不可执行"的情况，
 * 而这一步正是当初缺的（坏二进制要等用户跑起来才以 `spawn Unknown system error -88` 暴露）。
 * 仅当目标平台 == 当前平台时执行（交叉取资产无法在本机运行）。失败即删掉坏文件并抛错。
 */
function verifyInstalled(dest, finalName, key) {
  // ⚠️ 用字面量比较，不要用 targetKey()：后者在不支持的宿主（如 linux/x64）上会 throw，
  // 于是文档里的 `--target win32-x64` 交叉准备会在写完第一个资产后崩掉。
  if (key !== `${process.platform}-${process.arch}`) { console.log('  · 交叉平台资产，跳过可执行自检'); return; }
  let r;
  try {
    r = spawnSync(dest, ['--version'], { encoding: 'utf8', timeout: 20000 });
  } catch (e) {
    r = { error: e };
  }
  const out = String((r && r.stdout) || '').trim();
  const err = String((r && r.stderr) || '').trim();
  const okRun = r && !r.error && r.status === 0 && out.length > 0;
  if (okRun) { console.log(`  ✓ 可执行自检通过：${out.split('\n')[0]}`); return; }
  try { fs.rmSync(dest, { force: true }); } catch {}
  throw new Error(`${finalName} 落位后无法执行（status=${r && r.status}${r && r.error ? '，' + r.error : ''}`
    + `${err ? '，stderr: ' + err.slice(0, 200) : ''}）。已删除该文件，请重跑 npm run setup。`);
}

/**
 * 解压 .zst → Buffer。
 * 首选 Node 内置 zstd（node:zlib.zstdDecompressSync，需 Node ≥ 22.15 / 23.8）；
 * 老版本 Node 回退系统 `zstd` 命令行；两者都没有时给出可执行的解决建议，
 * 而不是抛出 "zstdDecompressSync is not a function" 这种看不懂的错。
 */
export function zstdDecode(file) {
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
    const { got: hash } = verifyHash(asset, cached, pin.pins || {});
    let raw;
    try {
      const packed = fs.readFileSync(cached);
      assertSaneSize(asset, zstdDeclaredSize(packed) ?? 0, (pin.sizes || {})[asset], zstdDeclaredSize(packed));
      raw = zstdDecode(cached);
    } catch (e) {
      purgeCache(cached);   // 缓存不可信（含 .ok）→ 下次重新下载，不会卡在"重跑也没用"的循环里
      throw new Error(`${e.message}；已清除该缓存与完成标记，请重跑命令重新下载。`);
    }
    const dest = placeBinary(VENDOR, finalName, raw);
    console.log(`  → ${dest}（${mb(raw.length)}）`);
    try {
      verifyInstalled(dest, finalName, key);
    } catch (e) {
      purgeCache(cached);
      throw e;
    }
    markOk(cached);   // 解压/体积/落位/可执行四项全过 → 才把这份缓存记为"完整下载"
    results.push({ asset, finalName, sha256: hash, bytes: raw.length });
  }

  const { missing } = assertColocated(VENDOR, spec.required);
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
