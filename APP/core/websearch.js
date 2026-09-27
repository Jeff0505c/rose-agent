'use strict';
/**
 * ROSE 内置联网搜索 / 网页抓取 —— **不使用任何 MCP，也不依赖外部运行时**。
 *
 * 为什么自己做：codex 原生的 `web_search` 是**服务端能力**（实测仅在 OpenAI/ChatGPT 系 provider 下
 * 暴露给模型；DeepSeek 等第三方 provider 下模型根本没有这个工具），而 MCP 方案要求用户装
 * Node/Python（npx/uvx）。ROSE 直接用自己的主进程做搜索 → 抓正文 → 作为上下文注入本轮输入，
 * 于是**任何 provider 都能联网**，用户零安装。
 *
 * 搜索源优先级（对齐 Open WebUI 的成熟做法）：
 *   显式配置的 provider → tavily/brave/exa（有 key 时）→ searxng（有实例地址）→ DuckDuckGo（免 key 兜底）
 * 兜底抓取可能被限流或改版，所以按优先级链做，并在失败时依次降级。
 */

const DEFAULT_LIMIT = 5;
const MAX_PAGE_CHARS = 12000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

/** 去脚本/样式/标签 → 纯文本（纯函数，便于测试） */
function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 解析 DuckDuckGo HTML 结果页（纯函数） */
function parseDdgHtml(html, limit = DEFAULT_LIMIT) {
  const out = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]+class="[^"]*result__a|<\/div>\s*<\/div>\s*<\/div>|$)/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < limit) {
    let url = String(m[1] || '').trim();
    // DDG 的跳转链接：//duckduckgo.com/l/?uddg=<encoded>
    const enc = url.match(/[?&]uddg=([^&]+)/);
    if (enc) { try { url = decodeURIComponent(enc[1]); } catch { /* 保留原样 */ } }
    if (!/^https?:\/\//i.test(url)) continue;
    const title = stripHtml(m[2]);
    const block = m[3] || '';
    const sn = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    const snippet = sn ? stripHtml(sn[1]) : '';
    if (title && !out.some((r) => r.url === url)) out.push({ title, url, snippet });
  }
  return out;
}

/**
 * 解析 Bing 结果页（纯函数）。**为什么以 Bing 为免费兜底**：本机实测（中国网络）
 * `cn.bing.com` 200 ✓，而 `html.duckduckgo.com` / `lite.duckduckgo.com` / `r.jina.ai` /
 * `searx.be` / `api.search.brave.com` 全部不可达 ✗ —— DDG 兜底在这里等于没有联网能力。
 */
function parseBingHtml(html, limit = DEFAULT_LIMIT) {
  const out = [];
  const blocks = String(html || '').split(/<li class="b_algo"/i).slice(1);
  for (const b of blocks) {
    if (out.length >= limit) break;
    const a = b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = a[1];
    if (!/^https?:\/\//i.test(url)) continue;
    const title = stripHtml(a[2]);
    const cap = b.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || b.match(/class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = cap ? stripHtml(cap[1]).slice(0, 500) : '';
    if (title && !out.some((r) => r.url === url)) out.push({ title, url, snippet });
  }
  return out;
}

/** 解析 SearXNG JSON（纯函数） */
function parseSearxng(json, limit = DEFAULT_LIMIT) {
  const rows = (json && Array.isArray(json.results)) ? json.results : [];
  return rows.slice(0, limit).filter((r) => r && r.url).map((r) => ({
    title: String(r.title || r.url), url: String(r.url), snippet: String(r.content || '').slice(0, 500),
  }));
}

/** 解析通用 JSON（tavily/brave/exa 形状归一，纯函数） */
function parseGeneric(json, limit = DEFAULT_LIMIT) {
  const rows = (json && (json.results || (json.web && json.web.results) || json.data)) || [];
  return rows.slice(0, limit).filter((r) => r && (r.url || r.link)).map((r) => ({
    title: String(r.title || r.name || r.url || r.link),
    url: String(r.url || r.link),
    snippet: String(r.content || r.description || r.snippet || r.text || '').slice(0, 500),
  }));
}

/** 选搜索源（纯函数）：显式 provider 优先，其次按"有 key/有实例"的能力降级 */
function pickProvider(web = {}) {
  const keys = web.keys || {};
  const want = String(web.provider || 'auto').toLowerCase();
  if (want && want !== 'auto') {
    if (want === 'searxng' && web.searxngUrl) return 'searxng';
    if (want === 'bing' || want === 'ddg') return want;
    if (keys[want]) return want;
    return 'bing';   // 配置的源不可用 → 兜底，保证"联网"不静默失效
  }
  if (keys.tavily) return 'tavily';
  if (keys.exa) return 'exa';
  if (keys.brave) return 'brave';
  if (web.searxngUrl) return 'searxng';
  return 'bing';   // 默认：Bing（实测国内可达、免 key）；ddg 仅作为额外一档
}

async function httpJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeoutMs || 15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function httpText(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || 15000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

/**
 * 搜索。返回 { ok, provider, results, error? }；**失败会自动向下一档降级**，不会静默返回空。
 * @param {string} query
 * @param {{provider?:string, searxngUrl?:string, keys?:object, limit?:number}} web
 */
async function searchWeb(query, web = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, provider: null, results: [], error: '空查询词' };
  const limit = Math.max(1, Math.min(10, Number(web.limit) || DEFAULT_LIMIT));
  const order = [];
  const first = pickProvider(web);
  for (const p of [first, 'tavily', 'exa', 'brave', 'searxng', 'bing', 'ddg']) if (!order.includes(p)) order.push(p);
  const keys = web.keys || {};
  let lastErr = null;
  for (const p of order) {
    try {
      if (p === 'searxng') {
        if (!web.searxngUrl) continue;
        const base = String(web.searxngUrl).replace(/\/+$/, '');
        const json = await httpJson(`${base}/search?q=${encodeURIComponent(q)}&format=json&safesearch=1`);
        const results = parseSearxng(json, limit);
        if (results.length) return { ok: true, provider: 'searxng', results };
        lastErr = new Error('searxng 无结果'); continue;
      }
      if (p === 'tavily') {
        if (!keys.tavily) continue;
        const json = await httpJson('https://api.tavily.com/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: keys.tavily, query: q, max_results: limit, search_depth: 'basic' }),
        });
        const results = parseGeneric(json, limit);
        if (results.length) return { ok: true, provider: 'tavily', results };
        lastErr = new Error('tavily 无结果'); continue;
      }
      if (p === 'brave') {
        if (!keys.brave) continue;
        const json = await httpJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${limit}`,
          { headers: { 'X-Subscription-Token': keys.brave, Accept: 'application/json' } });
        const results = parseGeneric(json, limit);
        if (results.length) return { ok: true, provider: 'brave', results };
        lastErr = new Error('brave 无结果'); continue;
      }
      if (p === 'exa') {
        if (!keys.exa) continue;
        const json = await httpJson('https://api.exa.ai/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': keys.exa },
          body: JSON.stringify({ query: q, numResults: limit }),
        });
        const results = parseGeneric(json, limit);
        if (results.length) return { ok: true, provider: 'exa', results };
        lastErr = new Error('exa 无结果'); continue;
      }
      if (p === 'bing') {
        let html = '';
        try {
          html = await httpText(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&ensearch=0`);
        } catch {
          html = await httpText(`https://www.bing.com/search?q=${encodeURIComponent(q)}&ensearch=0`);
        }
        const results = parseBingHtml(html, limit);
        if (results.length) return { ok: true, provider: 'bing', results };
        lastErr = new Error('bing 无结果（页面结构可能变了）'); continue;
      }
      // DuckDuckGo 免 key 兜底（HTML 端点；中国网络通常不可达，故排在 bing 之后）
      const html = await httpText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
      const results = parseDdgHtml(html, limit);
      if (results.length) return { ok: true, provider: 'ddg', results };
      lastErr = new Error('duckduckgo 无结果（可能被限流）');
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, provider: null, results: [], error: (lastErr && lastErr.message) || '搜索失败' };
}

/** 抓取网页正文（去标签），用于给模型提供原文片段 */
async function fetchReadable(url, opts = {}) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { ok: false, error: '仅支持 http(s)' };
    const html = await httpText(url, { timeoutMs: opts.timeoutMs });
    const title = (String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    const text = stripHtml(html).slice(0, Number(opts.maxChars) || MAX_PAGE_CHARS);
    return { ok: true, title: title ? stripHtml(title) : u.hostname, text };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '抓取失败' };
  }
}

module.exports = {
  searchWeb, fetchReadable,
  stripHtml, parseDdgHtml, parseBingHtml, parseSearxng, parseGeneric, pickProvider,
  DEFAULT_LIMIT, MAX_PAGE_CHARS,
};
