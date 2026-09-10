'use strict';
/**
 * 平台能力层 —— 全项目唯一的平台差异入口（开源架构约束：业务层不得出现 process.platform）
 *
 * 设计意图：
 *  - 平台差异集中在此，便于社区贡献与审查；新增平台只需加一个适配分支 + 测试。
 *  - 纯函数、零依赖、可离线测试（tests/platform.test.mjs）。
 *
 * 支持矩阵（既定）：macOS arm64 + Windows x64。不支持 Intel mac / Windows arm64。
 */

const SUPPORTED = { darwin: ['arm64'], win32: ['x64'] };

function isWin(platform = process.platform) { return platform === 'win32'; }
function isMac(platform = process.platform) { return platform === 'darwin'; }

/** 是否受支持的 平台/架构 组合 */
function isSupported(platform = process.platform, arch = process.arch) {
  return (SUPPORTED[platform] || []).includes(arch);
}

/**
 * codex 主可执行文件名（决定 vendor/ 里放哪个二进制）。
 * 不受支持的组合返回 null，由调用方决定回退策略（避免在 mac 上误抛错）。
 */
function codexBinName(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'codex-aarch64-apple-darwin';
  if (platform === 'win32' && arch === 'x64') return 'codex.exe';
  return null;
}

/** 断言平台受支持；不受支持时抛出可读错误（供安装/构建期使用） */
function assertSupported(platform = process.platform, arch = process.arch) {
  if (isSupported(platform, arch)) return true;
  throw new Error(`不支持的平台/架构：${platform}/${arch}（本项目支持 macOS arm64 与 Windows x64）`);
}

/** Windows 沙箱必需的三件套（必须与主 exe 同目录，见 codex#32655/#30829） */
function codexHelperNames(platform = process.platform, arch = process.arch) {
  if (platform !== 'win32' || arch !== 'x64') return [];
  return ['codex-windows-sandbox-setup.exe', 'codex-command-runner.exe'];
}

/** 随包本地工具（如 github-mcp-server）的扩展名 */
function toolsExt(platform = process.platform) { return isWin(platform) ? '.exe' : ''; }

/**
 * 把注册表里的 MCP 命令解析成可 spawn 的形式：
 *  - 绝对路径：原样
 *  - 包管理器（npx/uvx/…）：走 PATH；Windows 补 .cmd/.exe（**不能**拼到随包工具目录）
 *  - 解释器：Windows 上 python3 → py
 *  - 其余裸名：视为随包工具，落到 toolsDir
 *  - shell 内置：Windows 需 cmd /c
 */
function resolveCommand(cmd, platform = process.platform, toolsDir = '') {
  if (typeof cmd !== 'string' || !cmd) return cmd;
  if (cmd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cmd)) return cmd;

  if (isWin(platform) && ['dir', 'copy', 'echo', 'type', 'set'].includes(cmd)) return `cmd /c ${cmd}`;

  const PM = new Set(['npx', 'npm', 'pnpm', 'yarn', 'uvx', 'uv']);
  if (PM.has(cmd)) {
    if (!isWin(platform)) return cmd;
    return /^(npx|npm|pnpm|yarn)$/.test(cmd) ? cmd + '.cmd' : cmd + '.exe';
  }

  const PY = new Set(['python', 'python3', 'py', 'pip', 'pip3']);
  if (PY.has(cmd)) {
    if (!isWin(platform)) return cmd;
    return cmd === 'python3' ? 'py' : (cmd === 'pip3' ? 'pip' : cmd);
  }

  const sep = isWin(platform) ? '\\' : '/';
  const name = cmd.replace(/^tools[\\/]/, '');
  const ext = toolsExt(platform);
  const withExt = name.endsWith(ext) ? name : name + ext;
  return toolsDir ? toolsDir + sep + withExt : withExt;
}

/**
 * 写入 TOML 基本字符串的路径必须转义反斜杠。
 * 反例（Windows 上会写出非法 TOML）：`[projects."C:\Users\..."]`
 */
function tomlPath(p) { return JSON.stringify(p); }

/**
 * Windows 专属沙箱配置行（mac 返回空）。
 * mode: 'elevated'（首选，需管理员初始化）| 'unelevated'（回退，网络隔离较弱）
 */
function sandboxConfigLines(platform = process.platform, mode = 'elevated') {
  if (!isWin(platform)) return [];
  if (!['elevated', 'unelevated'].includes(mode)) throw new Error(`非法 Windows 沙箱模式：${mode}`);
  return ['[windows]', `sandbox = ${JSON.stringify(mode)}`, 'sandbox_private_desktop = true'];
}

/**
 * 进程回收策略：Windows 必须整树回收；POSIX 直接 kill。
 * child.kill() 在 Windows 上只杀直接子进程，codex 派生的 shell/工具会变孤儿。
 */
function killStrategy(platform = process.platform) {
  if (isWin(platform)) return { kind: 'tree-taskkill', fallback: 'taskkill /PID <pid> /T /F' };
  return { kind: 'direct-kill', fallback: 'kill <pid>' };
}

/**
 * 整树回收命令（纯函数，便于离线测试）。
 * Windows 无零依赖的 Job Object 绑定方式（需原生模块），故用系统 taskkill /T：
 * 先杀子树再杀自身，等价于 job 终止，且不引入任何依赖。
 */
function killCommand(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (isWin(platform)) return { cmd: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
  return null; // POSIX 直接用 child.kill()
}

/**
 * 回收一个子进程（含其整棵进程树）。
 * - Windows：taskkill /T /F（同步、忽略失败）→ 兜底 child.kill()
 * - POSIX：child.kill()（与既有行为完全一致，避免 mac 回归）
 */
function killTree(child, platform = process.platform, deps = {}) {
  if (!child || child.exitCode !== null) return false;
  const kc = killCommand(child.pid, platform);
  if (kc) {
    const spawnSync = deps.spawnSync || require('child_process').spawnSync;
    try { spawnSync(kc.cmd, kc.args, { stdio: 'ignore', windowsHide: true }); } catch { /* 进程已消失 */ }
  }
  try { child.kill(); } catch { /* 已退出 */ }
  return true;
}

/** spawn 的平台选项：Windows 必须隐藏控制台窗口，否则每个子进程都会闪黑框 */
function spawnOptions(platform = process.platform) {
  return isWin(platform) ? { windowsHide: true } : {};
}

/** PowerShell 单引号字面量转义：'It''s' —— Windows 解压命令拼接用 */
function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

/** 解压策略：Windows 无 unzip；Node 24+ 自带 zstd（本函数只管 zip） */
function unzipStrategy(platform = process.platform) {
  if (isWin(platform)) {
    return { kind: 'expand-archive', cmd: 'powershell -NoProfile -Command Expand-Archive' };
  }
  return { kind: 'system-unzip', cmd: 'unzip' };
}

/** 解压命令（纯函数）：返回可直接交给 spawnSync 的 { cmd, args } */
function unzipArgs(zipPath, outDir, platform = process.platform) {
  if (isWin(platform)) {
    return {
      cmd: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(outDir)} -Force`],
    };
  }
  return { cmd: 'unzip', args: ['-o', '-q', zipPath, '-d', outDir] };
}

/* ---------------- Windows 路径合法性 ---------------- */

const WIN_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);
const WIN_BAD_CHARS = /[<>"|?*\u0000-\u001f]/;
const MAX_PATH_SAFE = 200;   // MAX_PATH=260，为 codex 派生的临时文件名留余量

/**
 * 检查一个绝对路径能否在目标平台安全使用。
 * 返回 [{ code, msg }]；空数组 = 通过。POSIX 只拦 NUL 与相对性。
 * code: nul | bad-char | colon | trailing | reserved | empty-segment | long | relative
 */
function pathIssues(p, platform = process.platform) {
  const out = [];
  if (typeof p !== 'string' || !p) return [{ code: 'empty', msg: '路径为空' }];
  if (p.includes('\u0000')) return [{ code: 'nul', msg: '路径包含 NUL 字符' }];
  if (!isWin(platform)) return out;

  const isDrive = /^[A-Za-z]:[\\/]/.test(p);
  const isUnc = /^\\\\/.test(p);
  if (!isDrive && !isUnc) out.push({ code: 'relative', msg: '必须是绝对路径（盘符或 UNC）' });

  const body = isDrive ? p.slice(2) : p;
  if (WIN_BAD_CHARS.test(body)) out.push({ code: 'bad-char', msg: '包含 Windows 非法字符 <>:"|?*' });
  const colonAt = body.indexOf(':');
  if (colonAt >= 0) out.push({ code: 'colon', msg: '盘符之外不允许出现冒号' });

  for (const seg of body.split(/[\\/]/)) {
    if (!seg) continue;
    if (/[. ]$/.test(seg)) {
      out.push({ code: 'trailing', msg: `目录/文件名不能以点或空格结尾：${seg}` });
    }
    const base = seg.split('.')[0].toLowerCase();
    if (WIN_RESERVED.has(base)) {
      out.push({ code: 'reserved', msg: `使用了 Windows 保留设备名：${seg}` });
    }
  }
  if (p.length > MAX_PATH_SAFE) {
    out.push({ code: 'long', msg: `路径过长（${p.length} > ${MAX_PATH_SAFE}），部分工具会失败` });
  }
  return out;
}

/**
 * 把任意字符串变成合法的文件名/目录名（跨平台）。
 * Windows 下会替换非法字符、去掉结尾点/空格、规避保留名；POSIX 只拦 '/' 与 NUL。
 * 幂等：对已合法的输入返回原值。
 */
function sanitizeFilename(name, platform = process.platform) {
  let s = String(name == null ? '' : name);
  if (isWin(platform)) {
    s = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    s = s.replace(/[. ]+$/, '');
    if (!s) s = 'untitled';
    if (WIN_RESERVED.has(s.split('.')[0].toLowerCase())) s = '_' + s;
  } else {
    s = s.replace(/[/\u0000]/g, '_');
    if (!s || s === '.' || s === '..') s = 'untitled';
  }
  if (s.length > 120) {
    const dot = s.lastIndexOf('.');
    if (dot > 0 && s.length - dot <= 12) s = s.slice(0, 120 - (s.length - dot)) + s.slice(dot);
    else s = s.slice(0, 120);
  }
  return s;
}

/** 便于在 UI/日志里给出人话结论：路径是否可在当前平台使用 */
function assertPathUsable(p, platform = process.platform) {
  const issues = pathIssues(p, platform);
  if (issues.length) throw new Error(`路径不可用（${platform}）：${issues.map((i) => i.msg).join('；')} —— ${p}`);
  return true;
}

module.exports = {
  SUPPORTED,
  isWin, isMac, isSupported, assertSupported,
  codexBinName, codexHelperNames, toolsExt,
  resolveCommand, tomlPath, sandboxConfigLines,
  killStrategy, killCommand, killTree, spawnOptions,
  unzipStrategy, unzipArgs, psQuote,
  pathIssues, sanitizeFilename, assertPathUsable,
  WIN_RESERVED, MAX_PATH_SAFE,
};
