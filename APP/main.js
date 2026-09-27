'use strict';
/**
 * ROSE 桌面主进程 —— 窗口 / IPC / rose:// 协议 / 生命周期
 * 业务核心在 desktop/services.js（原 gateway/server.js 去 HTTP 化）
 */
const { app, BrowserWindow, ipcMain, protocol, shell, dialog, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const util = require('util');
const childProcess = require('child_process');
const maintenance = require('./core/maintenance');   // C/D 阶段：出厂清单维护 + 崩溃报告/预检/重置（无循环依赖）

/* ---------- 应用身份：开发态也显示为 ROSE（而不是 Electron） ----------
   注意：`app.setName()` 会连带改变 `app.getPath('userData')` → 会"看起来丢数据"
   （用户数据在 Application Support/<name>）。所以这里改名之后必须把 userData
   **钉回原路径**（开发态 = rose-desktop），保证与既有安装的数据目录一致。
   验证/多开可用 ROSE_USER_DATA=/tmp/xxx 覆盖（仅用于本地验证，不影响默认行为）。 */
app.setName('ROSE');
app.setAppUserModelId('com.rose.desktop');           // Windows 任务栏身份

/* ⚠️ 不要用 Electron 的 `isPackaged` 判断"是否打包态"：它按**可执行文件名**判定，
   而 ROSE 为了开发态也显示为 ROSE 会把 Electron.app/Electron 改名成 ROSE.app/ROSE
   （scripts/brand-dev-app.mjs）→ isPackaged **误报 true** → ROOT 被算成
   `userData/store`（不存在的空目录）→ 启动即报「settings.json 读取/解析失败」。
   `process.defaultApp` 由 Electron 默认应用在加载"你的 app 目录"时置位，与二进制叫
   什么名字无关：开发态 true、打包态 undefined。 */
const IS_PACKAGED = !process.defaultApp;
/* E2E 无前台窗口开关（**只影响测试**）：ROSE_E2E_HEADLESS=1 时窗口一律保持 hidden、
   不 show/setOpacity/setBounds、不抢焦点，macOS 还隐藏 Dock 图标；其余逻辑（启动、播种、
   引擎、服务、退出确认）全部照常，便于 E2E 断言。默认（未设置或非 '1'）行为与以前完全一致。 */
const E2E_HEADLESS = process.env.ROSE_E2E_HEADLESS === '1';
try {
  const override = process.env.ROSE_USER_DATA;
  if (override) app.setPath('userData', path.resolve(override));
  else if (!IS_PACKAGED) app.setPath('userData', path.join(app.getPath('appData'), 'rose-desktop'));
} catch (e) {
  console.warn('[rose] 设置 userData 路径失败：' + ((e && e.message) || e));
}
/* ---------- 崩溃报告目录（D 阶段） ----------
   DSH 口径：写 app.getPath('logs')，`ROSE_LOG_DIR` 可覆盖（隔离验证/多开用）。
   ⚠️ 目录创建失败**绝不影响启动**：报告降级为只打控制台。 */
let LOG_DIR = null;
try {
  if (process.env.ROSE_LOG_DIR) app.setPath('logs', path.resolve(process.env.ROSE_LOG_DIR));
  LOG_DIR = app.getPath('logs');
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
} catch (e) {
  LOG_DIR = null;
  console.warn('[crash] 日志目录不可用（崩溃报告将只打控制台）：' + ((e && e.message) || e));
}

/* ---------- 诊断捕获（有界环形缓冲，绝无无界累积） ----------
   引擎 stderr：engines.js 经 `process.stderr.write` 输出，主进程在这里 tee 一份（不改 engines/services）。
   error 级 console：包装 console.error。两者都是**纯 pass-through**：返回值/参数原样、绝不吞输出。 */
const STDERR_RING = maintenance.createByteRing(maintenance.MAX_STDERR_TAIL);      // ≤64KiB
const ERROR_RING = maintenance.createByteRing(maintenance.MAX_ERROR_CONSOLE);      // ≤32KiB
(function installDiagnosticsCapture() {
  const origWrite = process.stderr.write;
  process.stderr.write = function (chunk, enc, cb) {
    try {
      STDERR_RING.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk : String(chunk));
    } catch { /* 捕获失败绝不影响正常输出 */ }
    return origWrite.apply(this, arguments);
  };
  const origError = console.error;
  console.error = function (...args) {
    try {
      ERROR_RING.push(args.map((a) => (a instanceof Error ? (a.stack || a.message) : (typeof a === 'string' ? a : util.inspect(a, { depth: 3 })))).join(' ') + '\n');
    } catch { /* 忽略 */ }
    return origError.apply(console, args);
  };
})();

const APP_ICON_PNG = path.join(__dirname, 'build', 'icon.png');
app.setAboutPanelOptions({
  applicationName: 'ROSE',
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  copyright: 'ROSE',
  iconPath: APP_ICON_PNG,
});

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
if (IS_PACKAGED && !process.env.ROSE_ROOT) {
  process.env.ROSE_ROOT = path.join(app.getPath('userData'), 'store');
}
if (IS_PACKAGED && !process.env.ROSE_CODEX_HOME) {
  // CODEX_HOME 必须可写：打包后 core/ 在只读 asar 内，故放 userData
  process.env.ROSE_CODEX_HOME = path.join(app.getPath('userData'), 'codex-home');
}

/* ---------- 引擎进程监视：**必须**在 require('./services') 之前安装 ----------
   engines.js/services.js 在模块加载时 `const { spawn } = require('child_process')` 解构，
   晚装就抓不到任何 spawn。只对 codex app-server 挂 exit；纯 pass-through（不改参数、
   不吞事件、异常原样抛出、返回值原样）。只有"异常退出"才写报告：SIGTERM 是闲置回收/
   退出清理主动杀的，属正常，不报。 */
maintenance.watchEngineSpawns({
  cp: childProcess,
  onAbnormalExit: ({ code, signal, command }) => {
    writeCrashReport('engine', `引擎进程异常退出（code=${code} signal=${signal}）`, null, { command });
  },
  log: (m) => { try { console.warn(m); } catch { /* 忽略 */ } },
});

const services = require('./services');
const { seedIfNeeded } = require('./core/seed');
const { CODEX_BIN } = require('./core/engines');   // 只读：预检需要"引擎二进制的期望路径"
const platform = require('./core/platform');

// ROOT 与出厂默认数据目录（打包态=resources/defaults；开发态=仓库 defaults/）
const ROOT = process.env.ROSE_ROOT || path.join(__dirname, '..');
// RESOURCES：打包态 = Resources 目录（extraResources 落点），开发态 = 仓库根。
// 透传给 codex 子进程/技能（G 阶段 Office 随包 runtime 靠它拿绝对路径，不让模型猜路径）。
const RESOURCES = IS_PACKAGED ? process.resourcesPath : path.join(__dirname, '..');
process.env.ROSE_RESOURCES = RESOURCES;
const DEFAULTS_DIR = path.join(RESOURCES, 'defaults');

/* ---------- D 阶段：统一异常入口 + 崩溃报告 + 原生恢复对话框 ---------- */

/** 写崩溃报告（薄封装：把主进程侧已知上下文补齐）。写盘失败只打控制台，绝不二次抛出。 */
function writeCrashReport(source, reason, details, extra) {
  const r = maintenance.writeCrashReport({
    logDir: LOG_DIR, source, version: app.getVersion(), packaged: IS_PACKAGED, root: ROOT,
    reason, details, extra,
    stderrTail: STDERR_RING.text(), errorConsole: ERROR_RING.text(),
    log: (m) => { try { console.warn(m); } catch { /* 忽略 */ } },
  });
  try {
    if (r.ok) console.error(`[crash] 已写崩溃报告（${source}）：${r.path}`);
    else console.error(`[crash] 崩溃报告未写入（${source}）：${r.error}`);
  } catch { /* 忽略 */ }
  return r;
}

/** 打开日志目录（失败给出可读提示，绝不抛） */
async function openLogDir(logDir) {
  try {
    if (!logDir) throw new Error('日志目录不可用（未能解析 app.getPath(\'logs\')）');
    const err = await shell.openPath(logDir);
    if (err) throw new Error(err);
    return true;
  } catch (e) {
    try { dialog.showErrorBox('无法打开日志目录', String((e && e.message) || e)); } catch { /* 忽略 */ }
    return false;
  }
}

/** "备份数据后重置"：先备份（roles/** + work/data/**）→ 只隔离/重建损坏项 → 幂等 */
async function performReset({ faults = [], version = app.getVersion() } = {}) {
  const out = { action: 'reset', backup: null, moved: [], regenerated: [], skippedMissing: [], failed: [], unresolved: [] };
  try {
    if (faults.length) {
      const b = maintenance.backupBeforeUpgrade({
        root: ROOT, fromVersion: `reset-${version}`, toVersion: version, keep: maintenance.BACKUP_KEEP,
        log: (m) => { try { console.warn(m); } catch { /* 忽略 */ } },
      });
      out.backup = b ? b.name : null;
    }
    const plan = maintenance.planReset({ root: ROOT, faults, defaultsDir: DEFAULTS_DIR });
    const applied = maintenance.applyReset({ root: ROOT, plan, log: (m) => { try { console.warn(m); } catch { /* 忽略 */ } } });
    out.moved = applied.moved;
    out.regenerated = applied.regenerated;
    out.skippedMissing = applied.skippedMissing;
    out.failed = applied.failed;
    out.unresolved = plan.unresolved;
  } catch (e) {
    out.error = (e && e.message) || String(e);
  }
  try {
    console.log(`[reset] 重置完成：备份=${out.backup || '（无）'} 隔离=${out.moved.length} 重建=${out.regenerated.length} 未解决=${out.unresolved.length}`);
  } catch { /* 忽略 */ }
  return out;
}

let recoveryOpen = false;   // 同一时刻只允许一个恢复对话框（多窗口/多次崩溃不叠加）

/**
 * 启动故障原生恢复对话框（DSH 口径四动作）：
 * 退出 / 重启 / 备份数据后重置 / 打开日志目录（打开日志后回到对话框，不吞掉其它选择）。
 */
async function showRecoveryDialog({ title, message, detail, faults = [] } = {}) {
  if (recoveryOpen) return { action: 'skipped' };
  recoveryOpen = true;
  try {
    for (;;) {
      let r;
      try {
        r = await dialog.showMessageBox({
          type: 'error',
          title: title || 'ROSE 启动故障',
          message: message || 'ROSE 启动检查未通过',
          detail: `${detail || ''}\n\n日志目录：${LOG_DIR || '（不可用）'}\n崩溃报告会写在日志目录（最近 10 份，仅属主可读）。`,
          buttons: ['退出', '重启', '备份数据后重置', '打开日志目录'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      } catch (e) {
        // 对话框本身失败（极端环境）：退回到最原始的报错框，绝不留一个静默退出的进程
        try { dialog.showErrorBox(title || 'ROSE 启动故障', `${message || ''}\n\n${detail || ''}`); } catch { /* 忽略 */ }
        app.exit(1);
        return { action: 'quit', error: (e && e.message) || String(e) };
      }
      const idx = r && r.response;
      if (idx === 1) { app.relaunch(); app.exit(0); return { action: 'restart' }; }
      if (idx === 2) {
        const res = await performReset({ faults });
        let again = { response: 0 };
        try {
          again = await dialog.showMessageBox({
            type: 'info',
            title: 'ROSE 已重置',
            message: '损坏项已隔离，数据已备份',
            detail: `备份：${res.backup || '（无）'}\n隔离文件：${res.moved.map((x) => x.to).join('\n') || '（无）'}\n`
              + `重建：${res.regenerated.join('\n') || '（无）'}\n未解决：${res.unresolved.length} 项`
              + `${res.failed.length ? `\n失败：${res.failed.length} 项（详情见日志）` : ''}`,
            buttons: ['重启', '退出'],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
          });
        } catch { /* 提示框失败也要给出结论：默认重启 */ }
        if (again && again.response === 1) { app.exit(1); return { ...res, action: 'reset-quit' }; }
        app.relaunch(); app.exit(0);
        return { ...res, action: 'reset-restart' };
      }
      if (idx === 3) { await openLogDir(LOG_DIR); continue; }   // 看完日志回到对话框
      app.exit(1);
      return { action: 'quit' };
    }
  } finally {
    recoveryOpen = false;
  }
}

/** 渲染进程崩溃（C2）：报告 + 可执行动作（重载窗口 / 重启 / 打开日志目录 / 退出） */
async function showRendererRecoveryDialog({ report, details } = {}) {
  if (recoveryOpen) return { action: 'skipped' };
  recoveryOpen = true;
  try {
    const d = details || {};
    let r;
    try {
      r = await dialog.showMessageBox({
        type: 'error',
        title: 'ROSE 窗口已崩溃',
        message: `渲染进程已退出（reason=${d.reason || 'unknown'}${d.exitCode === undefined ? '' : ' exitCode=' + d.exitCode}）`,
        detail: `崩溃报告：${(report && report.path) || '（未写入）'}\n\n可以「重载窗口」继续使用（会话数据不受影响），或重启应用。`,
        buttons: ['重载窗口', '重启', '打开日志目录', '退出'],
        defaultId: 0,
        cancelId: 3,
        noLink: true,
      });
    } catch (e) {
      return { action: 'dialog-failed', error: (e && e.message) || String(e) };
    }
    const idx = r && r.response;
    if (idx === 0) {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      if (w) w.reload(); else createWindow();
      return { action: 'reload' };
    }
    if (idx === 1) { app.relaunch(); app.exit(0); return { action: 'restart' }; }
    if (idx === 2) { await openLogDir(LOG_DIR); return { action: 'open-logs' }; }
    app.exit(1);
    return { action: 'quit' };
  } finally {
    recoveryOpen = false;
  }
}

/* 统一异常入口之一：主进程未捕获异常 / 未处理 Promise 拒绝 */
process.on('uncaughtException', (err) => {
  const r = writeCrashReport('main', 'uncaughtException：' + ((err && err.message) || err), (err && err.stack) || String(err));
  if (app.isReady()) {
    showRecoveryDialog({
      title: 'ROSE 遇到未捕获异常',
      message: (err && err.message) || '主进程发生未捕获异常',
      detail: `崩溃报告：${r.path || '（未写入）'}\n建议先「打开日志目录」保留证据，再「重启」。`,
      faults: [],
    }).catch(() => { /* 恢复流程自身失败不再上抛 */ });
  } else {
    try { dialog.showErrorBox('ROSE 启动异常', String((err && err.stack) || err)); } catch { /* 忽略 */ }
    app.exit(1);
  }
});
process.on('unhandledRejection', (reason) => {
  const msg = (reason && reason.message) || String(reason);
  const r = writeCrashReport('main', 'unhandledRejection：' + msg, (reason && reason.stack) || String(reason));
  if (app.isReady()) {
    showRecoveryDialog({
      title: 'ROSE 遇到未处理的 Promise 拒绝',
      message: msg,
      detail: `崩溃报告：${r.path || '（未写入）'}`,
      faults: [],
    }).catch(() => { /* 忽略 */ });
  }
});

/* 统一异常入口之二：渲染进程 / 其它 Electron 子进程异常退出 */
app.on('render-process-gone', (_ev, webContents, details) => {
  const d = details || {};
  if (quitting || !maintenance.shouldReportRendererGone(d)) return;   // 退出流程/主动终止不算崩溃
  const url = (() => { try { return webContents && webContents.getURL(); } catch { return null; } })();
  const report = writeCrashReport('renderer', `渲染进程退出：reason=${d.reason} exitCode=${d.exitCode}`, null, { url, reason: d.reason, exitCode: d.exitCode });
  showRendererRecoveryDialog({ report, details: d }).catch(() => { /* 忽略 */ });
});
app.on('child-process-gone', (_ev, details) => {
  const d = details || {};
  if (quitting || !maintenance.shouldReportChildGone(d)) return;      // Renderer 由上面接管；GPU/Utility 主动终止不报
  writeCrashReport('child', `Electron 子进程退出：type=${d.type} reason=${d.reason} exitCode=${d.exitCode}`, null, d);
});

/* ---------- rose:// 协议必须先注册为特权 scheme（app ready 之前） ---------- */
protocol.registerSchemesAsPrivileged([
  { scheme: 'rose', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/* ---------- 单实例锁：二次启动聚焦已有窗口 ---------- */
const gotLock = app.requestSingleInstanceLock();
// ⚠️ 必须 return：拿到锁失败只 app.quit() 的话，模块继续执行到 whenReady → 播种/init/建窗口，
// 第二次启动可能真的再开一个窗口（而不是聚焦已有窗口）。
if (!gotLock) {
  app.quit();
  return;
} else {
  app.on('second-instance', () => {
    if (!revealExistingWindow()) ensureMainWindow();   // 隐藏态也要找回（关窗=隐藏档）
  });
}

/* ---------- 广播出口：services 的所有推送 → 所有渲染窗口 ---------- */
services.onBroadcast(({ event, data }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send('rose:sse', { event, data }); } catch {}
  }
});

let mainWindow = null;

/* ---------- 启动窗口尺寸：记住用户调整过的大小/位置（跨版本保留，存在 ROOT/work/data） ---------- */
const WINDOW_STATE = path.join(ROOT, 'work', 'data', 'window.json');
function readWindowState() {
  try {
    const j = JSON.parse(fs.readFileSync(WINDOW_STATE, 'utf8'));
    return (j && Number.isFinite(j.width) && Number.isFinite(j.height)) ? j : null;
  } catch { return null; }
}
let windowSaveTimer = null;
let geometryReady = false;   // 首次几何定位完成前不写记忆（避免把系统压过的中间尺寸存下来）
function saveWindowState() {
  if (!geometryReady) return;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return;
  try {
    const b = mainWindow.getBounds();
    fs.mkdirSync(path.dirname(WINDOW_STATE), { recursive: true });
    fs.writeFileSync(WINDOW_STATE, JSON.stringify({ width: b.width, height: b.height, x: b.x, y: b.y }));
  } catch { /* 数据目录不可写时忽略：下次仍用默认尺寸 */ }
}
function scheduleWindowSave() {
  if (windowSaveTimer) clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(saveWindowState, 600);   // 拖动/缩放过程中节流
}

function createWindow() {
  // 默认窗口尺寸：macOS 主流观感（约 1200×800），按屏幕可用区自适应，
  // 不再写死 1440×900（14" MacBook 上几乎顶满屏幕）。逻辑在 platform.defaultWindowSize（有测试）。
  let workArea = null;
  try { workArea = screen.getPrimaryDisplay().workArea; } catch (e) { /* 无显示信息时用默认 */ }
  const saved = readWindowState();
  // 有记住的尺寸 → 用它（并夹到当前可用区，换屏/插拔外接屏也不会跑到看不见的地方）；
  // 没有 → 用自适应主流默认尺寸并居中。
  const geo = platform.clampWindowToWorkArea(saved, workArea) || platform.defaultWindowSize(workArea);
  // 目标几何 = 记忆值（夹取后）或默认值；下面"显示后再定一次"要用到
  const targetGeo = { ...geo };
  if (!Number.isFinite(targetGeo.x) || !Number.isFinite(targetGeo.y)) {
    if (workArea && workArea.width && workArea.height) {
      targetGeo.x = Math.round((workArea.x || 0) + (workArea.width - geo.width) / 2);
      targetGeo.y = Math.round((workArea.y || 0) + (workArea.height - geo.height) / 2);
    }
  }
  // macOS/Windows 上先以"完全透明"显示再定尺寸：某些 macOS 环境会在**首次显示**那一刻把窗口
  // 宽度压到 ~1028（隐藏时设 bounds 无效，只有显示后 setBounds 才生效）。若直接 show 再改，
  // 用户会看到"先开错尺寸再跳一下"；透明期间改完再淡入，第一眼就是正确尺寸。
  const canFade = !E2E_HEADLESS && (platform.isMac(process.platform) || platform.isWin(process.platform));
  mainWindow = new BrowserWindow({
    ...geo,
    opacity: canFade ? 0 : 1,
    show: false,
    focusable: !E2E_HEADLESS,   // E2E：不可聚焦（即便被系统唤起也不抢前台）
    minWidth: 1000,
    minHeight: 640,
    center: !saved,        // 首次（无记忆）居中；有记忆则恢复用户原来的位置
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
  // 显示后立即定尺寸再淡入（顺序很关键：show 之后再 setBounds 才会生效）
  let revealed = false;
  const revealAtTarget = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      if (Number.isFinite(targetGeo.x) && Number.isFinite(targetGeo.y)) {
        mainWindow.setBounds(targetGeo);   // 显示后才会生效（系统改了尺寸的话在这里纠正回来）
      }
      const b = mainWindow.getBounds();
      if (b.width !== targetGeo.width || b.height !== targetGeo.height) {
        // 只记录，不再做第二次可见调整：能走到这里说明连 setBounds 都被系统否决了
        console.warn(`[rose] 窗口尺寸被系统调整为 ${b.width}×${b.height}（期望 ${targetGeo.width}×${targetGeo.height}）；`
          + '若开启了「台前调度/Stage Manager」或装了窗口管理工具，它们会在首次显示时接管新窗口尺寸。');
      }
    } finally {
      // 无论如何都要让窗口可见：淡入失败/提前异常时绝不能把窗口留在透明状态
      if (canFade) { try { mainWindow.setOpacity(1); } catch (e) { /* 不支持透明度时本就是可见的 */ } }
      revealed = true;
      geometryReady = true;
    }
  };
  mainWindow.once('ready-to-show', () => {
    if (E2E_HEADLESS) {
      // 测试开关：整段跳过"透明定位再淡入"（不 show / 不 setOpacity / 不 setBounds），窗口保持隐藏
      revealed = true;
      geometryReady = true;
      console.log('[rose] ROSE_E2E_HEADLESS=1：窗口保持隐藏（不显示、不抢焦点）');
      return;
    }
    mainWindow.show();
    revealAtTarget();
    // 保险：万一 revealAtTarget 因异常没把不透明度还原，1.5s 后强制显示（宁可尺寸不完美，也不能是空窗口）
    setTimeout(() => {
      if (E2E_HEADLESS) return;   // 测试开关：不存在"透明空窗口"问题，无需强制显示
      if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
      try { mainWindow.setOpacity(1); } catch (e) { /* 忽略 */ }
      geometryReady = true;
      console.warn('[rose] 窗口几何定位异常，已强制显示（尺寸可能不是目标值）');
    }, 1500);
  });
  mainWindow.on('resize', scheduleWindowSave);
  mainWindow.on('move', scheduleWindowSave);
  mainWindow.on('close', saveWindowState);    // 关窗前先落一次几何（与下面的 hide/quit 判定分开注册）
  mainWindow.on('close', (e) => {
    if (quitting) return;                     // 已在退出流程：放行销毁
    if (closeBehaviorMode() === 'hide') {     // 默认档：关窗 = 隐藏，任务继续（Dock/再次启动/activate 找回）
      e.preventDefault();
      try { mainWindow.hide(); } catch { /* 忽略 */ }
      return;
    }
    e.preventDefault();                       // 完全关闭档：仍然先确认"会中断什么"，绝不静默杀任务
    confirmQuit();
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
let servicesReady = false;       // services.init() 是否成功（欢迎窗口在后端未就绪时也要能显示）
let startupError = null;         // 启动失败原因（经 existing IPC 通道如实回给欢迎页，不新增通道）
ipcMain.handle('rose:api', (ev, payload) => {
  // 只接受"我们自己那个窗口的主框架"的调用：渲染进程一旦被注入脚本，不应能直接改设置/删角色/读附件
  const okFrame = BrowserWindow.getAllWindows().some((w) => w.webContents === ev.sender && ev.senderFrame === ev.sender.mainFrame);
  if (!okFrame) return { status: 403, body: { error: 'forbidden' } };
  // 后端未就绪：返回可读原因（欢迎页会把它显示出来，而不是白屏或静默失败）
  if (!servicesReady) {
    return { status: 503, body: { error: 'ROSE 后端未就绪：' + (startupError || '服务层尚未初始化') } };
  }
  const { method, path: rawPath, body } = payload || {};
  try {
    return services.dispatch(String(method || 'GET').toUpperCase(), String(rawPath || '/'), body || {});
  } catch (e) {
    return { status: 500, body: { error: '请求处理失败：' + ((e && e.message) || e) } };
  }
});

/* ---------- IPC：选择工作目录（新建会话时必填；会话内不可改） ---------- */
ipcMain.handle('rose:pick-directory', async (_ev, payload) => {
  const opts = {
    title: (payload && payload.title) || '选择工作目录',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '使用此目录',
  };
  try {
    const { canceled, filePaths } = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts);
    if (canceled || !filePaths || !filePaths.length) return { canceled: true };
    return { path: filePaths[0] };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
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

/* ---------- G 阶段 D4：随包 office 运行时预装/校验 ----------
   产品自身的"数据准备"（把 Resources/runtime 装到用户数据目录）**不该依赖模型动作与权限审批**：
   这里在启动时异步跑一次 `office-runtime.mjs ensure`（复用 runtime-office 的现成入口，不重写安装逻辑），
   装好后技能首次调用直接走"复用"快路径。异步、带超时、**失败绝不影响启动**，结果回填 runtime.json 供诊断。
   入口契约（见 runtime/README.md）：优先用随包包壳 runtime/bin/node（它认 ROSE_DESKTOP_NODE_EXECUTABLE），
   无包壳时回退 process.execPath + ELECTRON_RUN_AS_NODE=1；ROOT 经 ROSE_ROOT 传入。 */
const OFFICE_ENSURE_TIMEOUT_MS = Number.isFinite(Number(process.env.ROSE_OFFICE_ENSURE_TIMEOUT_MS)) && Number(process.env.ROSE_OFFICE_ENSURE_TIMEOUT_MS) > 0
  ? Number(process.env.ROSE_OFFICE_ENSURE_TIMEOUT_MS)
  : 300000;                       // 首次安装 137MiB：给足时间；已安装时包壳自身秒级复用
let officeEnsureStarted = false;
let officeEnsureChild = null;

function officeRuntimeEntry() { return path.join(RESOURCES, 'runtime', 'bin', 'office-runtime.mjs'); }

/** 异步预装/校验（绝不 throw）；返回状态对象便于 E2E 断言 */
async function ensureOfficeRuntime() {
  const entry = officeRuntimeEntry();
  const stamp = () => new Date().toISOString();
  if (!fs.existsSync(entry)) {
    maintenance.patchRuntimeInfo(ROOT, { officeRuntime: { state: 'missing-entry', ready: false, at: stamp(), entry } });
    console.warn(`[office-runtime] 未找到随包入口（${entry}）：跳过预装（技能侧仍可自行 ensure）`);
    return { state: 'missing-entry', ready: false };
  }
  const shim = path.join(RESOURCES, 'runtime', 'bin', process.platform === 'win32' ? 'node.cmd' : 'node');
  const useShim = fs.existsSync(shim);
  const command = useShim ? shim : process.execPath;
  const env = {
    ...process.env,
    ROSE_ROOT: ROOT,
    ROSE_RESOURCES: RESOURCES,
    ROSE_DESKTOP_NODE_EXECUTABLE: process.execPath,   // 包壳最权威的来源（开发态/副本态都靠它）
  };
  if (!useShim) env.ELECTRON_RUN_AS_NODE = '1';
  // 先落一个"进行中"状态：消费方（技能/UI/诊断）据此区分"尚未开始"与"正在装"，
  // 从而在预装期间选择等待而不是自己去跑 ensure（那会触发审批门 —— 见 D5）。
  maintenance.patchRuntimeInfo(ROOT, { officeRuntime: { state: 'installing', ready: false, at: stamp(), viaShim: useShim, timeoutMs: OFFICE_ENSURE_TIMEOUT_MS } });
  const res = await maintenance.runChildWithTimeout({
    spawn: childProcess.spawn,
    command,
    args: [entry, 'ensure', '--json'],
    env,
    timeoutMs: OFFICE_ENSURE_TIMEOUT_MS,
    onSpawn: (c) => { officeEnsureChild = c; },
    log: (m) => { try { console.warn(m); } catch { /* 忽略 */ } },
  });
  officeEnsureChild = null;
  let parsed = null;
  try {
    const line = String(res.stdout || '').trim().split('\n').filter(Boolean).pop();
    parsed = line ? JSON.parse(line) : null;
  } catch { parsed = null; }
  const state = res.ok ? 'ready' : (res.timedOut ? 'timeout' : 'failed');
  const info = {
    state,
    ready: !!res.ok,
    at: stamp(),
    durationMs: res.durationMs,
    exitCode: res.code === undefined ? null : res.code,
    signal: res.signal || null,
    action: (parsed && parsed.action) || null,
    runtimeId: (parsed && parsed.runtimeId) || null,
    dir: (parsed && parsed.dir) || null,
    viaShim: useShim,
    error: res.ok ? null : (res.error || (parsed && parsed.error) || ('exit=' + res.code)),
  };
  maintenance.patchRuntimeInfo(ROOT, { officeRuntime: info });
  console.log(`[office-runtime] 预装/校验：${state}（${res.durationMs}ms`
    + `${info.action ? `, action=${info.action}` : ''}${info.runtimeId ? `, ${info.runtimeId}` : ''}`
    + `${useShim ? ', via=包壳' : ', via=execPath'}）${res.ok ? '' : ' —— ' + (info.error || '')}`);
  return info;
}

/** 启动时踢一次（幂等、纯后台：不 await、不阻塞窗口；失败只记日志/状态） */
function kickOfficeRuntimeEnsure() {
  if (officeEnsureStarted) return;
  officeEnsureStarted = true;
  ensureOfficeRuntime().catch((e) => {
    try { console.warn('[office-runtime] 预装异常（不影响启动）：' + ((e && e.message) || e)); } catch { /* 忽略 */ }
  });
}

/* ---------- E/F 阶段：首启欢迎窗口 / 关窗行为 / 退出前任务确认 ---------- */

/** 关窗行为：settings.global.closeBehavior；默认 'hide'，未知值一律按 'hide'（且绝不影响启动） */
function closeBehaviorMode() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'roles', '_global', 'settings.json'), 'utf8'));
    const v = s && s.global && s.global.closeBehavior;
    return v === 'quit' ? 'quit' : 'hide';
  } catch { return 'hide'; }
}

/** 是否首启/未配置：无启用模型，或没有任何可用 Provider（含 keyless 本地 Provider）→ 进欢迎页 */
function needsWelcome() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'roles', '_global', 'settings.json'), 'utf8'));
    const enabled = (s && s.global && Array.isArray(s.global.enabledModels)) ? s.global.enabledModels : [];
    const provs = Object.entries((s && s.providers) || {})
      .filter(([id, p]) => p && (p.apiKey || p.keyless || String(id).toLowerCase() === 'ollama'));
    return enabled.length === 0 || provs.length === 0;
  } catch { return true; }   // 读不到（缺失/损坏）也算"需要引导"；欢迎页会把后端错误显示出来
}

let welcomeWindow = null;
let welcomeFlow = false;    // 首启引导进行中：此时 window-all-closed 不得退出应用
let openingMain = false;

/** 正在退出（已确认 / 清理中 / 退出确认框等待中）：此时**不得**再开任何新窗口 */
function isExiting() { return quitting || quitConfirmed || quitPromptOpen; }

/** 打开独立欢迎窗口（复用 preload.js，不新增 IPC 通道；后端未就绪也能显示） */
function createWelcomeWindow(errorMsg) {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    if (!E2E_HEADLESS) { welcomeWindow.show(); welcomeWindow.focus(); }
    return welcomeWindow;
  }
  const file = path.join(__dirname, 'UI', 'welcome.html');
  if (!fs.existsSync(file)) {           // 前端缺失：绝不留下一个空窗口，直接进工作区
    console.warn('[welcome] 未找到 UI/welcome.html，跳过欢迎窗口');
    return ensureMainWindow();
  }
  welcomeFlow = true;
  welcomeWindow = new BrowserWindow({
    width: 780, height: 680, minWidth: 620, minHeight: 520,
    show: false, center: true, title: 'ROSE 欢迎', autoHideMenuBar: true,
    icon: APP_ICON_PNG,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  welcomeWindow.once('ready-to-show', () => {
    if (E2E_HEADLESS) { console.log('[rose] ROSE_E2E_HEADLESS=1：欢迎窗口保持隐藏（分支照常建窗）'); return; }
    try { welcomeWindow.show(); } catch { /* 忽略 */ }
  });
  // 保存成功 / 「稍后配置」都由前端 window.close() 收尾 → 这里负责开主窗口（不新增 IPC 通道）
  welcomeWindow.on('closed', () => {
    welcomeWindow = null;
    welcomeFlow = false;
    if (!isExiting()) ensureMainWindow();     // 退出流程里被关掉不得反过来开主窗口
  });
  const query = {};
  if (errorMsg) query.error = String(errorMsg).slice(0, 400);   // 后端失败原因经 URL 传给欢迎页
  welcomeWindow.loadFile(file, { query });
  return welcomeWindow;
}

/** 确保主窗口存在且可见（首启流程与 activate/Dock 找回共用；绝不重复创建、绝不重跑几何定位） */
function ensureMainWindow() {
  if (isExiting()) return mainWindow;          // 退出流程中绝不新建窗口
  if (openingMain) return mainWindow;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!E2E_HEADLESS && !mainWindow.isVisible()) mainWindow.show();
    if (!E2E_HEADLESS) mainWindow.focus();
    return mainWindow;
  }
  openingMain = true;
  try { return createWindow(); } finally { openingMain = false; }
}

/** 单实例二次启动 / Dock 点击：找回窗口（隐藏态也找回），不重建、不重定几何 */
function revealExistingWindow() {
  const w = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow
    : BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
  if (!w) return false;
  if (E2E_HEADLESS) return true;   // E2E：找回语义保留，但绝不显示/抢焦点
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  w.focus();
  return true;
}

/**
 * 退出前查询"会中断什么"（2s 无应答按"有任务"处理——宁可多问一次，也不静默杀任务）。
 * 数据源：/api/running（运行中会话=agent，含其后的排队消息）+ 每会话 /api/sessions/:id/subagents（子代理）。
 * 后台任务 / 已挂定时提醒：ROSE 的定时任务模块已在 v0.13.3 整链移除，故为 0（如实说明，不假装有）。
 */
async function queryRunningWork(timeoutMs = 2000) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), timeoutMs));
  const query = (async () => {
    const res = await services.dispatch('GET', '/api/running', {});
    const running = (res && res.body && Array.isArray(res.body.running)) ? res.body.running : [];
    let subagents = 0;
    for (const sid of running) {
      try {
        const r = await services.dispatch('GET', `/api/sessions/${encodeURIComponent(sid)}/subagents`, {});
        const list = (r && r.body && Array.isArray(r.body.subagents)) ? r.body.subagents : [];
        subagents += list.filter((a) => a && ['spawned', 'running', 'waiting'].includes(a.state)).length;
      } catch { /* 单个会话查询失败不影响整体判断 */ }
    }
    return { running, subagents, timeout: false };
  })().catch((e) => ({ running: [], subagents: 0, error: (e && e.message) || String(e), timeout: false }));
  let r;
  try { r = await Promise.race([query, timeout]); }
  catch (e) { r = { timeout: true, error: (e && e.message) || String(e) }; }
  const hasWork = !!(r && (r.timeout || r.error || (r.running && r.running.length) || r.subagents));
  return { ...r, hasWork };
}

let quitPromptOpen = false;
let quitConfirmed = false;

/** 退出前确认（两档关窗行为都适用）：有任务（或查询超时）→ 弹框，默认按钮=取消 */
async function confirmQuit() {
  if (quitting || quitConfirmed || quitPromptOpen) return;
  quitPromptOpen = true;
  try {
    const w = await queryRunningWork(2000);
    if (!w.hasWork) { quitConfirmed = true; beginShutdown(0); return; }
    const items = [];
    if (w.timeout) items.push('• 任务状态查询超时（按"有任务"处理）');
    if (w.error) items.push('• 任务状态查询失败：' + w.error);
    if (w.running && w.running.length) items.push(`• 运行中的会话（含其排队消息）：${w.running.length} 个`);
    if (w.subagents) items.push(`• 运行中的子代理：${w.subagents} 个`);
    items.push('• 后台任务 / 已挂定时提醒：无（ROSE 无该模块）');
    const r = await dialog.showMessageBox({
      type: 'warning',
      title: 'ROSE 退出确认',
      message: '有任务正在运行，退出会中断它们',
      detail: items.join('\n') + '\n\n取消 = 继续在后台跑；仍然退出 = 立即中断这些任务。',
      buttons: ['取消', '仍然退出'],
      defaultId: 0,       // 默认 = 取消（对齐 DSH：超时/误按都不杀任务）
      cancelId: 0,
      noLink: true,
    });
    if (r && r.response === 1) { quitConfirmed = true; beginShutdown(0); }
  } catch (e) {
    // 确认框自身失败：按"有任务"处理——不退出，让用户显式再操作一次
    console.error('[rose] 退出确认失败（已按"有任务"处理，不退出）：' + ((e && e.message) || e));
  } finally {
    quitPromptOpen = false;
  }
}

/* ---------- 生命周期 ---------- */
app.whenReady().then(() => {
  // 菜单栏：Windows/Linux 下移除默认菜单（File/Edit/View… 与应用无关，且会顶掉一条视觉空间）。
  // macOS 保留：应用菜单在系统菜单栏里，⌘Q/⌘C/⌘V 等快捷键依赖它，删掉会破坏既有习惯。
  if (E2E_HEADLESS) {
    try { if (platform.isMac(process.platform) && app.dock) app.dock.hide(); } catch (e) { /* 忽略 */ }
    console.log('[rose] ROSE_E2E_HEADLESS=1：无前台窗口模式（Dock 隐藏、窗口不显示、不抢焦点）');
  }
  if (!platform.isMac(process.platform)) Menu.setApplicationMenu(null);

  // 启动时裁剪崩溃报告（保留最近 10 份）；运行期信息落盘，供诊断导出读"日志目录/版本/是否打包"
  try {
    const t = maintenance.trimCrashReports({ logDir: LOG_DIR, keep: maintenance.CRASH_KEEP, log: (m) => console.warn(m) });
    if (t.removed.length) console.log(`[crash] 启动裁剪：删除 ${t.removed.length} 份旧崩溃报告（保留最近 ${maintenance.CRASH_KEEP} 份）`);
    maintenance.writeRuntimeInfo(ROOT, {
      logsDir: LOG_DIR, version: app.getVersion(), packaged: IS_PACKAGED, root: ROOT,
      pid: process.pid, startedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[crash] 启动期诊断初始化失败（不影响启动）：' + ((e && e.message) || e));
  }
  // 出厂默认数据播种（只种一次；清单 ROOT/.seeded 存在即跳过，永不触碰用户 store）
  try {
    seedIfNeeded({ root: ROOT, defaultsDir: DEFAULTS_DIR, version: app.getVersion(), log: (m) => console.log(m) });
  } catch (e) {
    console.error('[seed] 播种失败（不阻断启动）：', e && e.message);
  }
  // 升级维护（C 阶段）：版本变化 → 备份 → top-up（只补缺失、绝不覆盖、用户删过的不复活）→ 写清单；
  // 旧格式清单（legacy）只登记不复制。⚠️ 版本号变化后**首次启动**会有一次备份 + 少量补文件，
  // 这是预期行为（design/productization-plan.md C），不是异常写盘；同版本启动零写入、不做哈希。
  try {
    maintenance.onStartup({ root: ROOT, defaultsDir: DEFAULTS_DIR, version: app.getVersion(), log: (m) => console.log(m) });
  } catch (e) {
    console.error('[maintenance] 出厂数据升级维护失败（不阻断启动）：', e && e.message);
  }
  // 播种后仍缺 settings.json：报错先说清"到底在哪个数据目录、默认目录在不在"，
  // 否则用户只看到一句 ENOENT（曾因 ROOT 被算错而完全摸不着头脑）。
  const settingsFile = path.join(ROOT, 'roles', '_global', 'settings.json');
  const defaultsOk = fs.existsSync(DEFAULTS_DIR);
  if (!fs.existsSync(settingsFile)) {
    console.error('[rose] 数据目录缺少 roles/_global/settings.json\n'
      + `  数据目录 ROOT = ${ROOT}\n`
      + `  出厂默认目录   = ${DEFAULTS_DIR}${defaultsOk ? '' : '（不存在，无法播种）'}\n`
      + '  开发态请用 `npm start`（ROOT 应为仓库目录）；也可用 ROSE_ROOT=<数据目录> 覆盖。');
  }
  // 启动前**只读**预检（D 阶段 C1/C3）：损坏 settings/sessions、索引已被隔离、引擎二进制缺失/体积异常
  // 都在这里被识别 → 写崩溃报告 + 原生恢复对话框；预检**只检测、绝不动磁盘**。
  const pf = maintenance.preflight({ root: ROOT, engineBin: CODEX_BIN, defaultsDir: DEFAULTS_DIR });
  const fatalFaults = pf.faults.filter((f) => f.severity === 'fatal');
  const warnFaults = pf.faults.filter((f) => f.severity !== 'fatal');
  if (warnFaults.length) {
    console.warn('[preflight] 启动警告（不阻塞）：\n' + maintenance.describeFaults(warnFaults));
  }
  if (fatalFaults.length) {
    const r = writeCrashReport('main', '启动前预检发现致命故障', maintenance.describeFaults(fatalFaults), pf.faults);
    showRecoveryDialog({
      title: 'ROSE 启动故障',
      message: fatalFaults.map((f) => f.detail).join('；'),
      detail: `${maintenance.describeFaults(fatalFaults)}\n\n崩溃报告：${r.path || '（未写入）'}\nROOT = ${ROOT}`,
      faults: fatalFaults,
    }).catch(() => { /* 忽略 */ });
    return;
  }
  // 菜单栏与窗口协议在两条分支（欢迎页 / 工作区）之间共用
  let protocolReady = false;
  const setupShared = () => {
    if (!protocolReady) { registerRoseProtocol(); protocolReady = true; }
    kickOfficeRuntimeEnsure();   // D4：异步预装/校验随包运行时（不阻塞窗口；headless 下照常执行）
    // macOS 开发态：Dock 图标临时换成 ROSE（打包态用 .app 内置 icns，无需这一步）
    if (platform.isMac(process.platform) && app.dock && !IS_PACKAGED) {
      try {
        const img = nativeImage.createFromPath(APP_ICON_PNG);
        if (!img.isEmpty()) app.dock.setIcon(img);
      } catch (e) {
        console.warn('[rose] 设置 Dock 图标失败：' + ((e && e.message) || e));
      }
    }
    app.on('activate', () => {   // mac 点 dock 图标：找回窗口（隐藏态也找回；不重建、不重定几何）
      if (revealExistingWindow()) return;
      if (!welcomeFlow) ensureMainWindow();
    });
  };

  try {
    services.init();          // 读 settings / 建 engine（失败会 throw，见下）
    servicesReady = true;
  } catch (e) {
    startupError = (e && e.message) || String(e);
    const r = writeCrashReport('main', '服务层初始化失败：' + startupError, (e && e.stack) || String(e), pf.faults);
    // 首启/未配置：后端起了没起来也要能进欢迎窗口（窗口内显示失败原因），而不是只给一个退出框
    if (needsWelcome()) {
      console.warn('[rose] 服务层未就绪（' + startupError + '），先打开欢迎窗口');
      setupShared();
      createWelcomeWindow(startupError);
      return;
    }
    showRecoveryDialog({
      title: 'ROSE 启动失败',
      message: startupError,
      detail: `${maintenance.describeFaults(pf.faults)}\n\n崩溃报告：${r.path || '（未写入）'}\n`
        + `ROOT = ${ROOT}\n默认目录 = ${DEFAULTS_DIR}${defaultsOk ? '' : '（不存在）'}\n\n`
        + '可「打开日志目录」取证，或「备份数据后重置」修复损坏数据。',
      faults: pf.faults.concat([{ severity: 'fatal', kind: 'init-failed', path: ROOT, detail: '服务层初始化失败：' + startupError, suggestion: '备份数据后重置（只隔离损坏项）' }]),
    }).catch(() => { /* 忽略 */ });
    return;
  }
  setupShared();
  // 首启引导（独立欢迎窗口）：无可用 Provider 或未启用任何模型 → 先开欢迎窗，
  // 保存成功 / 「稍后配置」（前端 window.close()）后才开主窗口 —— **首启不得同时出现空工作区窗口**
  if (needsWelcome()) {
    console.log('[rose] 首次启动/尚未配置模型：打开欢迎窗口（保存或「稍后配置」后进入工作区）');
    createWelcomeWindow(null);
    return;
  }
  ensureMainWindow();
});

let quitting = false;
/**
 * 统一退出入口：先置位"正在退出"（崩溃上报据此不再把退出期的进程销毁误报成崩溃），
 * 再优雅清理 codex 子进程。3s 兜底：清理挂住也必须退出（绝不能留一个不死的 App）。
 */
function beginShutdown(code = 0) {
  if (quitting) return;
  quitting = true;
  try { if (officeEnsureChild && !officeEnsureChild.killed) officeEnsureChild.kill('SIGTERM'); } catch { /* 忽略 */ }
  const done = () => app.exit(code);
  try {
    Promise.race([
      Promise.resolve(services.shutdown()).catch(() => {}),
      new Promise((r) => setTimeout(r, 3000)),
    ]).then(done, done);
  } catch { done(); }
}
app.on('before-quit', (e) => {
  if (quitting || quitConfirmed) return;
  e.preventDefault();                 // 先确认"会中断什么"，再异步清理 codex 子进程退出
  confirmQuit();
});
// 外部信号（脚本/系统要求退出）走同一条优雅退出链，并被崩溃上报识别为"退出"而非"崩溃"
process.on('SIGTERM', () => beginShutdown(0));
process.on('SIGINT', () => beginShutdown(0));
app.on('window-all-closed', () => {
  // 首启：欢迎窗口关闭 → 开主窗口（不退出）；其余按关窗行为：hide 保持后台存活，quit 走退出确认
  if (isExiting()) return;                     // 退出流程中不再开新窗口、也不再触发退出
  if (welcomeFlow) { welcomeFlow = false; ensureMainWindow(); return; }
  if (closeBehaviorMode() === 'hide') return;
  app.quit();
});
