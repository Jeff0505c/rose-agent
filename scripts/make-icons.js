#!/usr/bin/env node
/**
 * 从 SVG 母版生成应用图标与预览图（PNG / ICO / ICNS）—— 零第三方依赖，用 Electron 自己渲染。
 *
 *   cd APP && npx electron ../scripts/make-icons.js
 *   # 受限环境（无 GUI 沙箱）追加：--no-sandbox --user-data-dir=<可写目录>
 *
 * 设计要点：
 *  · **一个隐藏页面渲染全部产物**（图标 9 个尺寸 + 标志/组合标志预览）。
 *    早期实现是"每个尺寸开一个窗口再截图"，窗口反复创建/销毁时渲染进程会被系统回收，
 *    单页 canvas 只需一次加载，又快又稳。
 *  · ICO / ICNS 容器格式很简单，手写几十行即可，避免引入 sharp / png2icns 等依赖。
 *
 * 两条容易踩的设计约束（原先写在 APP/UI/logo/README.md，该文件已删，规则保留在此）：
 *  1) **品牌标志必须显式指定颜色，绝不能用 currentColor**：浅色主题下文字色是深色，
 *     会把深色笔画画在深色方片上（实测对比度 1.07:1，等于看不见）。
 *     该问题由 mvp/electron-smoke.js 的主题审计兜底（浅/深两套主题各测一次）。
 *  2) **小尺寸必须用加粗母版**：细描线缩到 16px 后会淡到不可见（详见下方 SMALL_MAX）。
 *
 * 母版：APP/UI/logo/rose-tile.svg（应用图标）· rose-mark.svg · rose-lockup{,-light}.svg
 * 产物：APP/build/icon.{png,ico,icns} · APP/build/icons/<size>.png · APP/UI/logo/png/*
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const LOGO_DIR = path.join(REPO, 'APP', 'UI', 'logo');   // 标志与 UI 同处一棵树，不另设 assets 目录
const OUT_BUILD = path.join(REPO, 'APP', 'build');
const OUT_ICONS = path.join(OUT_BUILD, 'icons');
const OUT_PREVIEW = path.join(LOGO_DIR, 'png');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const SMALL_MAX = 32;   // ≤ 此尺寸用简化母版（细描线在 16px 下会淡到看不见）
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];            // Windows 各场景取用不同尺寸
const ICNS_TYPES = { 32: 'ic11', 64: 'ic12', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };

/* ---------------- 渲染（单页 canvas，一次加载出全部位图） ---------------- */
function renderBatch(tasks) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 640, height: 480, show: false, frame: false,
      webPreferences: { offscreen: false, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true },
    });
    const page = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
      async function renderBatch(tasks) {
        const out = [];
        for (const t of tasks) {
          const blob = new Blob([t.svg], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('SVG 解析失败: ' + t.name)); img.src = url; });
          const c = document.createElement('canvas');
          c.width = t.w; c.height = t.h;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.clearRect(0, 0, t.w, t.h);
          ctx.drawImage(img, 0, 0, t.w, t.h);
          out.push({ name: t.name, dataUrl: c.toDataURL('image/png') });
          URL.revokeObjectURL(url);
          console.log('rendered ' + t.name);
        }
        return out;
      }
    </script></body></html>`;
    win.webContents.on('console-message', (_e, _lvl, msg) => { if (String(msg).startsWith('rendered ')) console.log('  · ' + String(msg).slice(9)); });
    win.webContents.once('did-finish-load', async () => {
      try {
        const results = await win.webContents.executeJavaScript(`renderBatch(${JSON.stringify(tasks)})`);
        win.destroy();
        const map = new Map();
        for (const r of results) {
          const buf = Buffer.from(String(r.dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');
          if (buf.length > 100) map.set(r.name, buf);
        }
        map.size ? resolve(map) : reject(new Error('没有渲染出任何位图'));
      } catch (e) { try { win.destroy(); } catch {} reject(e); }
    });
    win.webContents.once('did-fail-load', (_e, code, desc) => { try { win.destroy(); } catch {} reject(new Error(`加载失败 ${code} ${desc}`)); });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
  });
}

/* ---------------- 容器格式 ---------------- */
/** ICO（PNG 负载；Vista+ 支持） */
function buildIco(pngBySize) {
  const entries = ICO_SIZES.map((s) => ({ size: s, data: pngBySize.get(s) })).filter((e) => e.data);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);                 // type: 1 = icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);     // 256 编码为 0
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

/** ICNS（PNG 负载） */
function buildIcns(pngBySize) {
  const chunks = [];
  for (const [size, type] of Object.entries(ICNS_TYPES)) {
    const data = pngBySize.get(Number(size));
    if (!data) continue;
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    chunks.push(Buffer.concat([head, data]));
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/* ---------------- main ---------------- */
app.commandLine.appendSwitch('force-device-scale-factor', '1');   // 保证 1:1 像素输出

app.whenReady().then(async () => {
  const read = (f) => {
    const p = path.join(LOGO_DIR, f);
    if (!fs.existsSync(p)) throw new Error('找不到母版：' + p);
    return fs.readFileSync(p, 'utf8');
  };
  let tile, tileSmall;
  try { tile = read('rose-tile.svg'); } catch (e) { console.error('✗ ' + e.message); app.exit(1); return; }
  try { tileSmall = read('rose-tile-small.svg'); } catch { tileSmall = tile; console.warn('⚠ 缺少 rose-tile-small.svg，小尺寸将使用常规母版（可能过细）'); }

  const tasks = SIZES.map((s) => ({ name: `icon-${s}`, svg: s <= SMALL_MAX ? tileSmall : tile, w: s, h: s }));
  for (const [file, w, h, name] of [
    ['rose-mark.svg', 256, 256, 'preview-mark'],
    ['rose-lockup.svg', 900, 320, 'preview-lockup'],
    ['rose-lockup-light.svg', 900, 320, 'preview-lockup-light'],
  ]) {
    try { tasks.push({ name, svg: read(file), w, h }); } catch (e) { console.error('⚠ ' + e.message); }
  }

  const watchdog = setTimeout(() => {
    console.error('✗ 渲染超时（60s）—— 可能是某个 SVG 无法解析或渲染进程被系统回收');
    app.exit(2);
  }, 60000);

  console.log(`渲染 ${tasks.length} 张位图（单页一次加载）…`);
  let results;
  try {
    results = await renderBatch(tasks);
  } catch (e) {
    console.error('✗ 渲染失败：' + e.message);
    app.exit(1);
    return;
  }

  clearTimeout(watchdog);
  fs.mkdirSync(OUT_ICONS, { recursive: true });
  fs.mkdirSync(OUT_PREVIEW, { recursive: true });

  const pngBySize = new Map();
  for (const s of SIZES) {
    const buf = results.get(`icon-${s}`);
    if (!buf) { console.error(`  ✗ ${s}px 缺失`); continue; }
    pngBySize.set(s, buf);
    fs.writeFileSync(path.join(OUT_ICONS, `${s}.png`), buf);
    if (s >= 128) fs.writeFileSync(path.join(OUT_PREVIEW, `rose-tile-${s}.png`), buf);
    console.log(`  ✓ 图标 ${String(s).padStart(4)}px  ${(buf.length / 1024).toFixed(1)} KB`);
  }
  for (const [name, out] of [['preview-mark', 'rose-mark-256.png'], ['preview-lockup', 'rose-lockup.png'], ['preview-lockup-light', 'rose-lockup-light.png']]) {
    const buf = results.get(name);
    if (buf) { fs.writeFileSync(path.join(OUT_PREVIEW, out), buf); console.log(`  ✓ 预览 ${out}  ${(buf.length / 1024).toFixed(1)} KB`); }
  }

  const big = pngBySize.get(1024) || pngBySize.get(512);
  if (!big) { console.error('✗ 没有可用的位图，终止'); app.exit(1); return; }
  fs.writeFileSync(path.join(OUT_BUILD, 'icon.png'), pngBySize.get(512) || big);
  fs.writeFileSync(path.join(OUT_BUILD, 'icon-1024.png'), big);
  fs.writeFileSync(path.join(OUT_BUILD, 'icon.ico'), buildIco(pngBySize));
  fs.writeFileSync(path.join(OUT_BUILD, 'icon.icns'), buildIcns(pngBySize));

  console.log('\n产物：');
  for (const f of ['icon.png', 'icon-1024.png', 'icon.ico', 'icon.icns']) {
    const p = path.join(OUT_BUILD, f);
    if (fs.existsSync(p)) console.log(`  ${f.padEnd(16)} ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
  }
  console.log('\n界面用标志（矢量）：APP/UI/logo/*.svg');
  app.exit(0);
});
