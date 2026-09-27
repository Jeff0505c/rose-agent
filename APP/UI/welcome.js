'use strict';
/* ROSE 欢迎窗口（首启引导 · 三步向导）——独立窗口，零依赖。
   窗口由 main.js 打开（loadFile UI/welcome.html + 既有 APP/preload.js）；
   本文件只负责界面与 IPC/API 调用，不写任何配置文件的解析逻辑。

   动线（严格互斥，一屏一个主操作）：
     ① 选择入口：三张卡（本地模型 / 云厂商 API Key / 稍后配置）——本屏不含任何输入框
     ② 按路径只显示该路径需要的字段：
        · 本地：进入即自动探测 → 成功只显示"模型 + 开始使用"；失败=一句原因 + 「改用 API Key」
        · 云端：预设下拉 →（自定义才展开 Base URL）→ API Key → 主按钮「测试连接」→
                测试成功后才出现模型下拉、主按钮变「开始使用」
     ③ 完成：保存成功才 window.close()；失败留在第 2 步，错误就近显示在对应字段下方
   底部固定一行：左「上一步」（保留已填值）、右主按钮；全屏只有这一个主按钮。

   契约（services-api 最终形状）：
     GET  /api/welcome/presets        → { ok, presets:[{id,name,en?,baseUrl,envKey,wireApi,keyless?,local?}],
                                          state:{providerCount,enabledModelCount,shouldWelcome} }
     POST /api/welcome/test           → 恒 200 { ok, count?, models?, error? }              ★不落盘
     POST /api/welcome/detect-ollama  → 恒 200 { ok, found, baseUrl, models[], error }      ★不落盘
     POST /api/welcome/save           → { ok, provider:{...,keySet}, enabledModels }（不回明文 key）
   铁律：路由未就绪 → 明写"该能力当前不可用"；**禁止**"先存 draft 再 fetch"的回退（探测不得写盘）。 */

/* ---------- i18n（zh/en 两份，条目数必须齐平：mvp/ui-check.mjs 会断言） ---------- */
const WEL_I18N = {
  zh: {
    title: '欢迎使用 ROSE',
    sub: '选一项即可开始：本地模型免 Key，或填一个云厂商 API Key。',
    chooseLocal: '本地模型（Ollama，免 Key）',
    chooseLocalDesc: '本机已装 Ollama 时零配置开聊',
    chooseCloud: '云厂商 API Key',
    chooseCloudDesc: '填一个 Key，测通即可用',
    chooseLater: '稍后配置',
    chooseLaterDesc: '直接进入工作区，之后在设置里补',
    cloudPreset: '模型来源',
    cloudKey: 'API Key',
    cloudModel: '模型',
    localModel: '模型',
    custom: '自定义 OpenAI 兼容',
    urlLabel: 'Base URL',
    back: '上一步',
    testBtn: '测试连接',
    startBtn: '开始使用',
    testing: '测试中…',
    detecting: '正在探测本地 Ollama…',
    saving: '保存中…',
    testOk: '✓ 连接可用：{n} 个模型',
    detectOk: '✓ 已发现本地 Ollama：{n} 个模型',
    detectFail: '未发现本地 Ollama：{e}',
    useCloud: '改用 API Key',
    urlBad: '请填写 http(s) 开头的 Base URL',
    keyBad: '请填写 API Key',
    modelBad: '请选择模型',
    saveFail: '保存失败：{e}',
    unavailable: '后端未就绪：该能力当前不可用。可点「稍后配置」进入工作区，之后在 设置 → 模型配置 里补齐。',
    footNote: '配置只写入本机；默认关窗为「隐藏」，任务会继续运行，可用 Dock 图标找回。',
    alreadyConfigured: '检测到已有模型配置，可直接「稍后配置」进入工作区。',
  },
  en: {
    title: 'Welcome to ROSE',
    sub: 'Pick one to start: a local model with no key, or a cloud provider API key.',
    chooseLocal: 'Local model (Ollama, no key)',
    chooseLocalDesc: 'Zero configuration when Ollama runs on this machine',
    chooseCloud: 'Cloud provider API key',
    chooseCloudDesc: 'Paste one key, test it, and you are set',
    chooseLater: 'Configure later',
    chooseLaterDesc: 'Jump straight into the workspace and set it up in Settings',
    cloudPreset: 'Provider',
    cloudKey: 'API Key',
    cloudModel: 'Model',
    localModel: 'Model',
    custom: 'Custom OpenAI-compatible',
    urlLabel: 'Base URL',
    back: 'Back',
    testBtn: 'Test connection',
    startBtn: 'Start using',
    testing: 'Testing…',
    detecting: 'Detecting local Ollama…',
    saving: 'Saving…',
    testOk: '✓ Connection works: {n} model(s)',
    detectOk: '✓ Local Ollama found: {n} model(s)',
    detectFail: 'No local Ollama found: {e}',
    useCloud: 'Use an API key instead',
    urlBad: 'Enter a Base URL starting with http(s)',
    keyBad: 'Please enter the API key',
    modelBad: 'Please pick a model',
    saveFail: 'Save failed: {e}',
    unavailable: 'The backend is not ready: this capability is unavailable right now. You can click "Configure later" and fill it in under Settings → Models.',
    footNote: 'Settings stay on this machine; the default close behaviour is "hide" — tasks keep running and the Dock icon brings the window back.',
    alreadyConfigured: 'Existing model configuration detected — you can also click "Configure later" to jump straight in.',
  },
};

/* 语言：优先 URL ?lang=zh|en（main.js 可带上 settings.global.language），否则跟随系统 */
function pickLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'zh' || q === 'en') return q;
  } catch (e) { /* 非标准环境忽略 */ }
  return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
const LANG = pickLang();
const tr = (k) => (WEL_I18N[LANG] && WEL_I18N[LANG][k] !== undefined) ? WEL_I18N[LANG][k] : (WEL_I18N.zh[k] !== undefined ? WEL_I18N.zh[k] : k);
const $ = (s) => document.querySelector(s);

/* ---------- API：桌面走 IPC 垫片，浏览器/无垫片时退回 fetch（纯前端自测用） ---------- */
async function api(method, path, body) {
  if (window.rose && window.rose.invokeApi) return window.rose.invokeApi(method, path, body);
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

/* ---------- 状态（跨步骤保留已填值：只切 hidden，不重建表单） ---------- */
const state = {
  step: 1,            // 1=选择入口  2=按路径配置
  path: null,         // 'local' | 'cloud'
  presets: [],        // 云厂商预设（服务端，已排除本地 Ollama）
  localPreset: null,  // 本地 Ollama 预设（服务端）
  presetId: '',       // 当前选中的云端预设 id（'custom' 表示自定义）
  models: [],         // 最近一次测试成功拿到的模型
  localModels: [],    // 本地探测到的模型
  localBaseUrl: 'http://127.0.0.1:11434/v1',
  localReady: false,  // 本地探测成功
  cloudReady: false,  // 云端测试成功
  available: false,   // presets 路由可用
  busy: false,        // 主按钮进行中（防重入）
};

/* ---------- 小工具 ---------- */
function setText(sel, text, cls) {
  const el = $(sel);
  if (!el) return;
  el.textContent = text || '';
  if (cls !== undefined) el.className = cls;
}
function setFieldErr(sel, text) { setText(sel, text, 'wel-err'); }
function clearFieldErrs() {
  ['#welUrlErr', '#welKeyErr', '#welModelErr', '#welLocalErr'].forEach((s) => setText(s, '', 'wel-err'));
}
function fillSelect(sel, items, keepValue) {
  const el = $(sel);
  if (!el) return;
  const prev = keepValue ? el.value : '';
  el.innerHTML = items.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  if (prev && items.includes(prev)) el.value = prev;
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** 主按钮 = 全屏唯一的主操作（随路径与状态变化：测试连接 → 开始使用） */
function setPrimary(label, opts) {
  const b = $('#welPrimary');
  if (!b) return;
  const o = opts || {};
  b.textContent = label || '';
  b.hidden = !label;
  b.disabled = !!o.disabled;
}
function setBackVisible(v) { const b = $('#welBack'); if (b) b.hidden = !v; }

/* ---------- 步骤切换（互斥显示；已填值保留在 DOM/state 里） ---------- */
function showStep1() {
  state.step = 1;
  state.path = null;
  $('#welStep1').hidden = false;
  $('#welStepLocal').hidden = true;
  $('#welStepCloud').hidden = true;
  setBackVisible(false);
  setPrimary('');                  // 第 1 步：卡片本身就是操作，底部无主按钮
}
function showCloud() {
  state.step = 2;
  state.path = 'cloud';
  $('#welStep1').hidden = true;
  $('#welStepLocal').hidden = true;
  $('#welStepCloud').hidden = false;
  setBackVisible(true);
  clearFieldErrs();
  setText('#welCloudNote', '');
  $('#welModelWrap').hidden = true;   // 换路径/重进都要重新测试
  state.cloudReady = false;
  if (!state.available) {             // 路由不可用：明写原因、不给可点的假成功路径
    setText('#welCloudNote', tr('unavailable'), 'wel-msg bad');
    setPrimary('');
    return;
  }
  setPrimary(tr('testBtn'));
}
function showLocal() {
  state.step = 2;
  state.path = 'local';
  $('#welStep1').hidden = true;
  $('#welStepCloud').hidden = true;
  $('#welStepLocal').hidden = false;
  setBackVisible(true);
  clearFieldErrs();
  state.localReady = false;
  $('#welLocalModelWrap').hidden = true;
  $('#welUseCloud').hidden = true;
  detectLocal();   // 进入即自动探测
}

/* ---------- 预设（一律读服务端；不硬编码厂商清单） ---------- */
function presetLabel(p) {
  if (!p) return '';
  if (LANG === 'en' && p.en) return p.en;
  return p.label || p.name || p.id;
}
function normalizePreset(p) {
  if (!p || typeof p !== 'object') return null;
  const id = String(p.id || '').trim();
  if (!id) return null;
  const local = p.local === true || p.keyless === true || id === 'ollama';
  return {
    id, label: presetLabel(p), baseUrl: String(p.baseUrl || ''),
    envKey: p.envKey ? String(p.envKey) : '',
    wireApi: p.wireApi === 'chat' ? 'chat' : 'responses',
    needsKey: p.needsKey !== undefined ? !!p.needsKey : !local,
    local,
  };
}
function renderPresetOptions() {
  const el = $('#welPreset');
  if (!el) return;
  const items = state.presets.concat([{ id: 'custom', label: tr('custom'), baseUrl: '', needsKey: true, local: false }]);
  el.innerHTML = items.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('');
  el.value = state.presetId || (items[0] && items[0].id) || '';
  if (el.value) state.presetId = el.value;
}
function currentPreset() {
  return state.presets.find((x) => x.id === state.presetId) || null;
}
function isCustom() { return state.presetId === 'custom'; }
function currentBaseUrl() {
  if (isCustom()) return String(($('#welUrl') && $('#welUrl').value) || '').trim();
  const p = currentPreset();
  return p ? p.baseUrl : '';
}
/** 预设/Key/URL 变化 → 之前那次测试结果作废（模型下拉收起、主按钮回到「测试连接」） */
function invalidateTest() {
  state.cloudReady = false;
  state.models = [];
  const mw = $('#welModelWrap');
  if (mw) mw.hidden = true;
  const ms = $('#welModel');
  if (ms) ms.innerHTML = '';
  setFieldErr('#welModelErr', '');
  setText('#welCloudNote', '');
  if (state.step === 2 && state.path === 'cloud' && state.available) setPrimary(tr('testBtn'));
}
function onPresetChange() {
  const el = $('#welPreset');
  state.presetId = el ? el.value : '';
  const custom = isCustom();
  const wrap = $('#welUrlWrap');
  if (wrap) wrap.hidden = !custom;     // Base URL **只在自定义时展开**
  if (!custom) {
    const p = currentPreset();
    const url = $('#welUrl');
    if (url && p) url.value = p.baseUrl || '';
  }
  const kw = $('#welKeyWrap');
  if (kw) kw.hidden = !!(currentPreset() && currentPreset().needsKey === false);
  invalidateTest();
}

/* ---------- ② 云端：测试连接 ---------- */
async function testCloud() {
  clearFieldErrs();
  setText('#welCloudNote', '');
  const custom = isCustom();
  const baseUrl = currentBaseUrl();
  const keyEl = $('#welKey');
  const apiKey = String((keyEl && keyEl.value) || '');
  const p = currentPreset();
  if (!/^https?:\/\//i.test(baseUrl)) { setFieldErr('#welUrlErr', tr('urlBad')); return; }
  if (p && p.needsKey !== false && !apiKey) { setFieldErr('#welKeyErr', tr('keyBad')); return; }
  state.busy = true;
  setPrimary(tr('testing'), { disabled: true });
  let r = null;
  try { r = await api('POST', '/api/welcome/test', { baseUrl, apiKey, providerId: custom ? '' : state.presetId }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  state.busy = false;
  if (r && r.ok) {
    const models = Array.isArray(r.models) ? r.models : [];
    state.models = models;
    const n = Number.isFinite(Number(r.count)) ? Number(r.count) : models.length;
    if (models.length) {
      fillSelect('#welModel', models, true);
      $('#welModelWrap').hidden = false;     // ★ 只有测试成功才出现模型下拉
    }
    state.cloudReady = true;
    setText('#welCloudNote', tr('testOk').replace('{n}', String(n)), 'wel-msg ok');
    setPrimary(tr('startBtn'));
  } else {
    // 失败：不出现模型下拉；错误就近落在对应字段下方（自定义=URL 字段，否则=Key 字段）
    const err = (r && r.error) || 'unknown';
    if (custom) setFieldErr('#welUrlErr', err); else setFieldErr('#welKeyErr', err);
    setPrimary(tr('testBtn'));
  }
}

/* ---------- ② 本地：自动探测 ---------- */
async function detectLocal() {
  setText('#welLocalErr', '');
  setText('#welLocalMsg', tr('detecting'), 'wel-msg');
  $('#welLocalModelWrap').hidden = true;
  $('#welUseCloud').hidden = true;
  state.localReady = false;
  state.busy = true;
  setPrimary(tr('detecting'), { disabled: true });
  let r = null;
  try { r = await api('POST', '/api/welcome/detect-ollama', {}); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  state.busy = false;
  const found = !!(r && (r.available === true || r.found === true));
  if (r && r.baseUrl) state.localBaseUrl = String(r.baseUrl);
  if (found) {
    const models = (r && Array.isArray(r.models)) ? r.models.filter((m) => typeof m === 'string' && m) : [];
    state.localModels = models;
    fillSelect('#welLocalModel', models, true);
    $('#welLocalModelWrap').hidden = models.length === 0;
    state.localReady = true;
    setText('#welLocalMsg', tr('detectOk').replace('{n}', String(models.length)), 'wel-msg ok');
    setPrimary(tr('startBtn'));
  } else {
    // 失败：一句可读原因 + 「改用 API Key」（不出现模型下拉，也不给假的主按钮）
    setText('#welLocalMsg', '');
    setText('#welLocalErr', tr('detectFail').replace('{e}', (r && r.error) || 'Ollama not reachable'), 'wel-err');
    $('#welUseCloud').hidden = false;
    setPrimary('');
  }
}

/* ---------- ③ 完成：保存（成功才关窗；失败留在第 2 步并把错误就近显示） ---------- */
async function saveAndStart() {
  if (state.busy) return;
  if (state.path === 'cloud') {
    const p = currentPreset();
    const custom = isCustom();
    const modelId = String(($('#welModel') && $('#welModel').value) || '').trim();
    if (!modelId) { setFieldErr('#welModelErr', tr('modelBad')); return; }
    const baseUrl = currentBaseUrl();
    const body = {
      // 自定义 = 固定内部 id 'custom'（选择器里它是一条预设，不再单设 ID 输入框）
      providerId: custom ? 'custom' : state.presetId,
      name: custom ? tr('custom') : (p ? p.label : ''),
      baseUrl,
      apiKey: String(($('#welKey') && $('#welKey').value) || '') || undefined,
      envKey: p && p.envKey ? p.envKey : undefined,
      wireApi: p && p.wireApi ? p.wireApi : 'responses',
      modelId, modelIds: [modelId], models: state.models.slice(0, 500), enabledModels: [modelId], activate: true,
    };
    await postSave(body, custom ? '#welUrlErr' : '#welKeyErr');
    return;
  }
  // 本地：providerId 固定 ollama（codex 内置保留 provider），免 Key
  const modelId = String(($('#welLocalModel') && $('#welLocalModel').value) || '').trim();
  if (!modelId) { setText('#welLocalErr', tr('modelBad'), 'wel-err'); return; }
  await postSave({
    providerId: 'ollama', baseUrl: state.localBaseUrl, keyless: true,
    modelId, modelIds: [modelId], models: state.localModels.slice(0, 500), enabledModels: [modelId], activate: true,
  }, '#welLocalErr');
}
async function postSave(body, errSel) {
  state.busy = true;
  setPrimary(tr('saving'), { disabled: true });
  let r = null;
  try { r = await api('POST', '/api/welcome/save', body); } catch (e) { r = { error: (e && e.message) || String(e) }; }
  state.busy = false;
  if (!r || r.error || r.ok === false) {
    setFieldErr(errSel, tr('saveFail').replace('{e}', (r && r.error) || 'unknown'));
    setPrimary(tr('startBtn'));
    return;                       // ★ 失败不关窗、不跳步
  }
  window.close();                 // 成功才关窗；由 main.js 负责打开主窗口
}

/* ---------- 加载预设（失败 → 明写不可用；「稍后配置」永远可用） ---------- */
async function loadPresets() {
  let r = null;
  try { r = await api('GET', '/api/welcome/presets'); } catch { r = null; }
  const raw = r && Array.isArray(r.presets) ? r.presets : null;
  if (!r || r.error || !raw) {
    state.available = false;
    const warn = $('#welUnavailable');
    if (warn) warn.hidden = false;
    return;
  }
  state.available = true;
  const all = raw.map(normalizePreset).filter(Boolean);
  state.localPreset = all.find((p) => p.local) || null;
  if (state.localPreset) state.localBaseUrl = state.localPreset.baseUrl || state.localBaseUrl;
  state.presets = all.filter((p) => !p.local);                  // 云端路径的预设
  state.presetId = (state.presets[0] && state.presets[0].id) || 'custom';
  renderPresetOptions();
  onPresetChange();
  if (r.state && r.state.shouldWelcome === false) setText('#welFootNote', tr('alreadyConfigured'), 'wel-footnote');
}

/* ---------- 启动 ---------- */
(function init() {
  try { document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en'; } catch (e) { /* 忽略 */ }
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (k) el.textContent = tr(k);
  });
  $('#welChoices').addEventListener('click', (e) => {
    const card = e.target && e.target.closest ? e.target.closest('.wel-choice') : null;
    if (!card) return;
    const c = card.dataset.choice;
    if (c === 'later') { window.close(); return; }   // 稍后配置：不写盘
    if (c === 'local') { showLocal(); return; }
    showCloud();
  });
  $('#welPreset').addEventListener('change', onPresetChange);
  $('#welKey').addEventListener('input', invalidateTest);
  $('#welUrl').addEventListener('input', invalidateTest);
  $('#welBack').addEventListener('click', () => { clearFieldErrs(); showStep1(); });   // 保留已填值
  $('#welUseCloud').addEventListener('click', () => showCloud());
  $('#welPrimary').addEventListener('click', () => {
    if (state.step !== 2 || state.busy) return;
    if (state.path === 'local') { if (state.localReady) saveAndStart(); else detectLocal(); return; }
    if (state.cloudReady) saveAndStart(); else testCloud();
  });
  showStep1();
  loadPresets();
})();
