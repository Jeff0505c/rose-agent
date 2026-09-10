'use strict';
/**
 * 渲染进程唯一通道：
 *  - rose.invokeApi(method, path, body) → Promise(响应 body)   替代 fetch
 *  - rose.createEventSource()                                  替代 SSE（接口兼容，可被 new）
 */
const { contextBridge, ipcRenderer } = require('electron');

/* ---- api 垫片：语义对齐原 fetch 版——无论 2xx/4xx/5xx 都 resolve 业务 body ---- */
async function invokeApi(method, path, body) {
  const r = await ipcRenderer.invoke('rose:api', { method, path, body });
  return r ? r.body : undefined;
}

/* ---- EventSource 垫片：接口与浏览器 EventSource 对齐 ----
   原前端用法：es.addEventListener(name, e => JSON.parse(e.data))、es.onopen、es.onerror
   因此：① data 必须是 JSON 字符串（收到后 JSON.parse 才不炸）；
         ② onopen 在垫片构造完成时触发一次（复用前端"首连对账 syncRunning()"逻辑）；
         ③ onerror 永不触发（IPC 常驻，不存在断线重连）。

   实现注意：不能把「class 实例」或「class 构造器」经 contextBridge 传回主世界——
   contextBridge 只拷贝/代理对象「自有属性」，类实例的原型方法会丢失（es.addEventListener 变 undefined），
   直接暴露 class 构造器时 `new 代理类` 又会以普通调用触发真实构造器而抛错。
   所以这里构造一个「普通对象」，把 addEventListener/close 作为自有函数属性，
   让 contextBridge 把它们当作函数代理回主世界。 */
function createEventSource() {
  const listeners = new Map();
  const es = {
    onopen: null,
    onerror: null,
    addEventListener(name, cb) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(cb);
    },
    close() { listeners.clear(); },
  };
  ipcRenderer.on('rose:sse', (_ev, { event, data }) => {
    const cbs = listeners.get(event);
    if (!cbs) return;
    const e = { data: JSON.stringify(data) };   // 关键：字符串化，对齐 e.data 语义
    for (const cb of cbs) { try { cb(e); } catch (err) { console.error(err); } }
  });
  queueMicrotask(() => { if (es.onopen) es.onopen(); });   // "连接建立"
  return es;
}

/* ---- 保存文本文件（诊断导出）：主进程弹系统保存框 → { path } | { canceled } | { error } ---- */
async function saveText(filename, text) {
  try {
    return await ipcRenderer.invoke('rose:save-text', {
      filename: String(filename || 'rose.txt'),
      text: String(text == null ? '' : text),
    });
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}

contextBridge.exposeInMainWorld('rose', { invokeApi, createEventSource, saveText });
