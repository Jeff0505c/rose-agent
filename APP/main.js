'use strict';
/**
 * ROSE 桌面主进程 —— 窗口 / IPC / rose:// 协议 / 生命周期
 * 业务核心在 desktop/services.js（原 gateway/server.js 去 HTTP 化）
 */
const { app, BrowserWindow, ipcMain, protocol, shell, dialog, Menu } = require('electron');
const path = require('path');

/* ---------- 旧版本环境变量兼容（JeffAgent → ROSE 改名过渡）----------
   若外部脚本仍设置 JEFFAGENT_ROOT / JEFFAGENT_CODEX_HOME，迁移到新名字，
   避免"新旧文件混用"时把 ROOT 算错（开发者手工覆盖副本更新时最容易踩）。 */
for (const [oldName, newName] of [['JEFFAGENT_ROOT', 'ROSE_ROOT'], ['JEFFAGENT_CODEX_HOME', 'ROSE_CODEX_HOME']]) {
  if (!process.env[newName] && process.env[oldName]) {
    process.env[newName] = process.env[oldName];
    console.warn(`[rose] 检测到旧变量 ${oldName}，已作为 ${newName} 使用（建议改用新名字）`);
  }
}

/* ---------- ROOT / CODEX_HOME 解析：必须在 require 业务模块之前 ---------- */
// services/engines/skills/mcp 在 require 时就用 ROSE_ROOT 计算模块级路径常量，
// 因此 env 必须在此处先设好，否则打包态会把 ROOT 算成 asar 内的只读路径。
if (app.isPackaged && !process.env.ROSE_ROOT) {
  process.env.ROSE_ROOT = path.join(app.getPath('userData'), 'store');
}
if (app.isPackaged && !process.env.ROSE_CODEX_HOME) {
  // CODEX_HOME 必须可写：打包后 core/ 在只读 asar 内，故放 userData
  process.env.ROSE_CODEX_HOME = path.join(app.getPath('userData'), 'codex-home');
}

const services = require('./services');
const { seedIfNeeded } = require('./core/seed');
const platform = require('./core/platform');
const fs = require('fs');

// ROOT 与出厂默认数据目录（打包态=resources/defaults；开发态=仓库 defaults/）
const ROOT = process.env.ROSE_ROOT || path.join(__dirname, '..');
const DEFAULTS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'defaults')
  : path.join(__dirname, '..', 'defaults');

/* ---------- rose:// 协议必须先注册为特权 scheme（app ready 之前） ---------- */
protocol.registerSchemesAsPrivileged([
  { scheme: 'rose', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/* ---------- 单实例锁：二次启动聚焦已有窗口 ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
}

/* ---------- 广播出口：services 的所有推送 → 所有渲染窗口 ---------- */
services.onBroadcast(({ event, data }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send('rose:sse', { event, data }); } catch {}
  }
});

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'ROSE',
    icon: path.join(__dirname, 'build', 'icon.png'),   // Windows/Linux 窗口与任务栏图标（macOS 用打包图标）
    autoHideMenuBar: true,   // 兜底：即使菜单仍被设置也不显示（Windows/Linux）
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // 默认即 true，显式写出以防回归
      nodeIntegration: false,   // 渲染进程禁 Node，安全基线
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'UI', 'index.html'));
  // 安全：禁止页面内跳转离开本地文件；新开窗口一律走系统浏览器
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith('rose://')) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ---------- rose://attachment/<sessionId>?f=<saved> —— 附件回显（替代原 HTTP 端点） ---------- */
function registerRoseProtocol() {
  protocol.handle('rose', (req) => {
    const u = new URL(req.url);                       // rose://attachment/sxxxx?f=169...png
    const segs = u.pathname.replace(/^\/+/, '').split('/');
    if (segs[0] === 'attachment' && segs[1]) {
      const r = services.getAttachment(segs[1], u.searchParams.get('f') || '');
      if (r) return new Response(r.data, { headers: { 'Content-Type': r.mime, 'Cache-Control': 'no-cache' } });
      return new Response('not found', { status: 404 });
    }
    return new Response('not found', { status: 404 });
  });
}

/* ---------- IPC：渲染进程的 api() 垫片最终到达这里 ---------- */
ipcMain.handle('rose:api', (_ev, payload) => {
  const { method, path: rawPath, body } = payload || {};
  return services.dispatch(String(method || 'GET').toUpperCase(), String(rawPath || '/'), body || {});
});

/* ---------- IPC：诊断导出（保存文本文件到用户选定位置） ---------- */
ipcMain.handle('rose:save-text', async (_ev, payload) => {
  const { filename, text } = payload || {};
  // 文件名净化：跨平台非法字符 + Windows 保留名（诊断文件名由服务端生成，这里仍做防御）
  const safeName = platform.sanitizeFilename(filename || 'rose.txt');
  const opts = {
    title: '导出诊断文件',
    defaultPath: path.join(app.getPath('downloads'), safeName),
    filters: [{ name: '文本文件', extensions: ['txt'] }],
  };
  try {
    // 无窗口时不能传 undefined 作为父窗口（Electron 会把它当 options）
    const { canceled, filePath } = mainWindow
      ? await dialog.showSaveDialog(mainWindow, opts)
      : await dialog.showSaveDialog(opts);
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, String(text == null ? '' : text), 'utf8');
    return { path: filePath };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

/* ---------- 生命周期 ---------- */
app.whenReady().then(() => {
  // 菜单栏：Windows/Linux 下移除默认菜单（File/Edit/View… 与应用无关，且会顶掉一条视觉空间）。
  // macOS 保留：应用菜单在系统菜单栏里，⌘Q/⌘C/⌘V 等快捷键依赖它，删掉会破坏既有习惯。
  if (!platform.isMac(process.platform)) Menu.setApplicationMenu(null);
  // 出厂默认数据播种（只种一次；哨兵 ROOT/.seeded 存在即跳过，永不触碰用户 store）
  try {
    seedIfNeeded({ root: ROOT, defaultsDir: DEFAULTS_DIR, log: (m) => console.log(m) });
  } catch (e) {
    console.error('[seed] 播种失败（不阻断启动）：', e && e.message);
  }
  try {
    services.init();          // 读 settings / 建 engine（失败会 throw，见下）
  } catch (e) {
    dialog.showErrorBox('ROSE 启动失败', e.message + '\n\n请检查模型配置后重试。');
    app.exit(1);
    return;
  }
  registerRoseProtocol();
  createWindow();
  app.on('activate', () => {   // mac 点 dock 图标重现窗口
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();                 // 先异步清理 codex 子进程，再真正退出
  services.shutdown().finally(() => app.exit(0));
});
app.on('window-all-closed', () => app.quit());  // 单窗口应用：关窗即退出（触发上面的清理链）
