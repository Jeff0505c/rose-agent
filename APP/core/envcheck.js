'use strict';
/**
 * 环境自检 —— 应用内「设置 → 环境自检」与 scripts/doctor.mjs 共用同一实现。
 *
 * 设计约束：
 *  - 零依赖、纯 Node（不 require electron），故 CLI 与 GUI 都能跑；
 *  - 只读：唯一的写操作是「写一个临时文件再删掉」来验证目录可写；
 *  - 每条检查返回 { id, level: ok|warn|fail, detail, hint? }，UI 与 CLI 直接渲染；
 *  - Windows 专属检查只在 win32 出现，mac 上不会多出噪音项。
 *
 * 最重要的用途：定位「codex 启动无输出」。因此 codex 检查会真实执行 `--version`
 * 并回报 **退出码与 stderr**，而不是只判断文件是否存在。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const platform = require('./platform');

const CHECKS = { OK: 'ok', WARN: 'warn', FAIL: 'fail' };

/** PATH 中查找可执行文件；找到返回绝对路径，否则 null */
function which(cmd, plat = process.platform) {
  if (typeof cmd !== 'string' || !cmd) return null;
  // 绝对路径直接判存在：不再绕 `where`（Windows 上 where 对带反斜杠的绝对路径不可靠，
  // 曾导致随包工具明明存在却被判「不可用」）
  if (/^([A-Za-z]:[\\/]|\/)/.test(cmd)) {
    try { return fs.existsSync(cmd) ? cmd : null; } catch { return null; }
  }
  try {
    if (platform.isWin(plat)) {
      const r = spawnSync('where', [cmd], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      if (r.status === 0) {
        const first = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
        if (first) return first;
      }
      return null;
    }
    const r = spawnSync('/bin/sh', ['-c', 'command -v -- "$1"', 'sh', cmd], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0) {
      const first = String(r.stdout || '').trim().split('\n').filter(Boolean)[0];
      if (first) return first;
    }
  } catch { /* 查找失败按未找到处理 */ }
  return null;
}

/** 目录可写性（写一个临时文件再删除，不留垃圾） */
function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.ja-write-probe-' + process.pid);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

/**
 * 执行 codex 二进制的 --version，回报退出码/stderr。
 * Windows 静默退出（无 stdout）几乎总能在 exitCode/stderr 里看出线索。
 */
function probeBinary(binPath, plat = process.platform) {
  const out = { exists: false, ran: false, exitCode: null, stdout: '', stderr: '', error: null };
  try { out.exists = fs.existsSync(binPath); } catch { out.exists = false; }
  if (!out.exists) return out;
  try {
    const r = spawnSync(binPath, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    out.ran = true;
    out.exitCode = r.status;
    out.stdout = String(r.stdout || '').trim();
    out.stderr = String(r.stderr || '').trim();
    if (r.error) out.error = r.error.message;
  } catch (e) {
    out.error = (e && e.message) || String(e);
  }
  return out;
}

/** 读 MCP 注册表里用到的外部命令（去重） */
function mcpCommands(root) {
  const p = path.join(root, 'work', 'data', 'mcp-registry.json');
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const cmds = (j.servers || [])
      .filter((s) => s && s.active && s.type !== 'http' && s.type !== 'sse' && typeof s.command === 'string')
      .map((s) => s.command.trim())
      .filter((c) => c && !c.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(c));
    return [...new Set(cmds)];
  } catch { return []; }
}

/**
 * 命令解析（与 engines.resolveToolCommand 语义一致）：随包工具**存在才**用绝对路径，
 * 否则回退原命令名交由 PATH 解析。自检必须复用同一规则，否则会误报「命令缺失」。
 */
function defaultResolveCommand(cmd, plat, toolsDir) {
  const r = platform.resolveCommand(cmd, plat, toolsDir || '');
  const isAbs = r.startsWith('/') || /^[A-Za-z]:[\\/]/.test(r);
  if (!isAbs) return r;                       // 包管理器/解释器/shell 内建
  try { return fs.existsSync(r) ? r : cmd; } catch { return cmd; }
}

/**
 * 执行全部检查。
 * @param {object} o
 * @param {string} o.root          用户数据根（ROOT）
 * @param {string} o.codexHome     CODEX_HOME
 * @param {string} o.engineBin     codex 主二进制路径
 * @param {string[]} o.helperNames Windows 三件套文件名（同目录要求）
 * @param {object} o.sandbox       { status, mode } —— 由调用方（GUI/探针）提供，可空
 * @param {'win32'|'darwin'} o.plat 目标平台（默认 process.platform）
 */
function runChecks(o = {}) {
  const plat = o.plat || process.platform;
  const items = [];
  const add = (id, level, detail, hint) => items.push({ id, level, detail, ...(hint ? { hint } : {}) });

  // 1) 平台支持矩阵
  const arch = o.arch || process.arch;
  if (platform.isSupported(plat, arch)) {
    add('platform', CHECKS.OK, `${plat}/${arch} 受支持`);
  } else {
    add('platform', CHECKS.FAIL, `${plat}/${arch} 不受支持`, '仅支持 macOS arm64 与 Windows x64');
  }

  // 2) 运行环境（信息项：Electron 自带 Node，用户无需安装）
  add('runtime', CHECKS.OK, `Node ${process.version} / Electron ${process.versions.electron || '（CLI 直跑）'}`);

  // 3) ROOT 可用性
  const root = o.root || '';
  if (!root) add('root', CHECKS.FAIL, '未解析出用户数据目录 ROOT');
  else {
    const issues = platform.pathIssues(root, plat);
    const hard = issues.filter((i) => i.code !== 'long');
    if (hard.length) add('root', CHECKS.FAIL, hard.map((i) => i.msg).join('；'), '换一个更短的纯 ASCII 路径（如 C:\\ROSE）');
    else if (!writable(root)) add('root', CHECKS.FAIL, `目录不可写：${root}`, '安装到 Program Files 后请确认数据目录在用户目录下');
    else if (issues.some((i) => i.code === 'long')) add('root', CHECKS.WARN, `路径较长（${root.length} 字符）`, 'Windows 上部分工具受 MAX_PATH 限制，建议短路径');
    else add('root', CHECKS.OK, root);
  }

  // 4) CODEX_HOME 可写（打包后必须在 userData，不能落在只读 asar 内）
  const codexHome = o.codexHome || '';
  if (!codexHome) add('codex-home', CHECKS.WARN, '未设置 CODEX_HOME（将退回包内路径，打包态不可写）');
  else if (writable(codexHome)) add('codex-home', CHECKS.OK, codexHome);
  else add('codex-home', CHECKS.FAIL, `不可写：${codexHome}`, '打包后应指向 userData 目录');

  // 5) codex 主二进制：真实执行 --version
  const bin = o.engineBin || '';
  const probe = probeBinary(bin, plat);
  if (!probe.exists) {
    add('codex-binary', CHECKS.FAIL, `未找到：${bin || '(空路径)'}`, '先运行 npm run setup 获取对应平台二进制');
  } else if (!probe.ran || probe.error) {
    add('codex-binary', CHECKS.FAIL, `无法执行：${probe.error || '未知错误'}`, '检查文件权限/杀软拦截');
  } else if (probe.exitCode === 0 && probe.stdout) {
    add('codex-binary', CHECKS.OK, `${probe.stdout.split('\n')[0]}（${bin}）`);
  } else if (!probe.stdout && !probe.stderr) {
    // 正是「静默退出」特征：给出可操作线索，不做无依据的归因
    add('codex-binary', CHECKS.FAIL,
      `启动后无任何输出（exitCode=${probe.exitCode}）`,
      '按顺序排查：① 杀毒软件/安全策略拦截 ② CODEX_HOME 不可写 ③ 直接在该目录手动执行该 exe 看系统报错');
  } else {
    add('codex-binary', CHECKS.WARN,
      `非零退出（exitCode=${probe.exitCode}）：${(probe.stderr || probe.stdout).slice(0, 200)}`);
  }

  // 6) Windows 专属
  if (platform.isWin(plat)) {
    const names = o.helperNames || platform.codexHelperNames(plat, arch);
    if (names.length) {
      const dir = path.dirname(bin || '');
      const missing = names.filter((n) => { try { return !fs.existsSync(path.join(dir, n)); } catch { return true; } });
      if (missing.length) add('codex-helpers', CHECKS.FAIL, `缺少同目录文件：${missing.join('、')}`, '三件套必须与 codex.exe 同目录（codex#32655/#30829）');
      else add('codex-helpers', CHECKS.OK, `三件套齐全（${names.length} 个 helper 与主程序同目录）`);
    }
    const ps = which('powershell', plat);
    if (ps) add('powershell', CHECKS.OK, ps);
    else add('powershell', CHECKS.FAIL, '未找到 powershell', '技能 zip 导入依赖 Expand-Archive');

    // 命令执行 shell：codex 在 Windows 上走 PowerShell（系统自带，已在上一条确认）。
    // pwsh（PS7）/ git-bash 只是加分项，缺了不影响运行，故不再报 warn 以免误导。
    const shell = which('pwsh', plat) || which('bash', plat);
    if (shell) add('shell', CHECKS.OK, `另可用：${shell}`);
    else if (ps) add('shell', CHECKS.OK, '命令执行使用 Windows PowerShell（系统自带）；装 Git for Windows 可额外获得 git-bash');
    else add('shell', CHECKS.WARN, '未找到可用的命令 shell', '建议安装 Git for Windows（自带 git-bash）');

    if (o.sandbox && o.sandbox.status) {
      const st = o.sandbox.status;
      const mode = (o.sandbox.mode || 'elevated');
      if (st === 'ready') add('sandbox', CHECKS.OK, `沙箱就绪（${mode}）`);
      else if (st === 'notApplicable') add('sandbox', CHECKS.OK, '非 Windows 平台，无需沙箱初始化');
      else if (st === 'notConfigured') add('sandbox', CHECKS.WARN, `沙箱未初始化（${mode}）`, '在「设置 → Windows 沙箱」点初始化；elevated 会弹 UAC');
      else if (st === 'updateRequired') add('sandbox', CHECKS.WARN, '沙箱需要更新', '重新执行一次初始化');
      else add('sandbox', CHECKS.WARN, `沙箱状态未知：${st}${o.sandbox.error ? '（' + o.sandbox.error + '）' : ''}`);
    } else {
      add('sandbox', CHECKS.WARN, '沙箱状态未知', 'codex app-server 尚未返回 readiness');
    }
  }

  // 7) MCP 外部命令（决策 A：不内置运行时，缺失只提示不阻断）
  const cmds = mcpCommands(o.root || '');
  if (cmds.length) {
    const resolve = o.resolveCommand || defaultResolveCommand;
    const missing = cmds.filter((c) => !which(resolve(c, plat, o.toolsDir || ''), plat));
    if (missing.length) {
      add('mcp-commands', CHECKS.WARN, `MCP 依赖的命令不可用：${missing.join('、')}`,
        '这些 MCP 需要宿主 Node/uv/Python（本项目不内置运行时）；不需要可在此停用该 MCP');
    } else {
      add('mcp-commands', CHECKS.OK, `已启用 MCP 的命令均可用（${cmds.join('、')}）`);
    }
  }

  const summary = items.reduce((a, i) => { a[i.level] = (a[i.level] || 0) + 1; return a; }, { ok: 0, warn: 0, fail: 0 });
  return { items, summary, at: Date.now(), platform: `${plat}/${arch}` };
}

/** 人类可读报告（CLI 打印 + 诊断导出共用） */
function formatReport(r) {
  const mark = { ok: '✓', warn: '!', fail: '✗' };
  const lines = [`环境自检（${r.platform}）  ✓${r.summary.ok} !${r.summary.warn} ✗${r.summary.fail}`];
  for (const i of r.items) {
    lines.push(`${mark[i.level] || '?'} ${i.id.padEnd(14)} ${i.detail}`);
    if (i.hint) lines.push(`${' '.repeat(16)}↳ ${i.hint}`);
  }
  return lines.join('\n');
}

module.exports = { runChecks, formatReport, which, writable, probeBinary, mcpCommands, defaultResolveCommand, CHECKS };
