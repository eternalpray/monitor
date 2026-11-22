// 前端 API 封装：REST 查询 + SSE 订阅。无任何外部请求，全部走同源 /api。

async function http(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || body.ok === false) {
    throw new Error((body.error && body.error.message) || `请求失败 ${res.status}`);
  }
  return body;
}

function qs(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, v);
  }
  const s = q.toString();
  return s ? '?' + s : '';
}

export const api = {
  health: () => http('/api/health'),
  records: (params = {}) => http(`/api/records${qs(params)}`),
  stats: () => http('/api/stats'),
  metrics: () => http('/api/metrics'),
  series: (metric, limit = 200) => http(`/api/series?metric=${encodeURIComponent(metric)}&limit=${limit}`),
  config: () => http('/api/config'),
  updateConfig: (patch) => http('/api/config', { method: 'PUT', body: JSON.stringify(patch) }),
  errors: () => http('/api/errors'),
  scan: () => http('/api/scan', { method: 'POST' }),
  clear: () => http('/api/clear', { method: 'POST' }),
  demoEmit: (count = 1) => http(`/api/demo/emit?count=${count}`, { method: 'POST' }),
  demoSlow: () => http('/api/demo/slow', { method: 'POST' }),

  // ---- v1.1：域 / 参与者 / 主题 / 兼容性 ----
  domains: (params = {}) => http(`/api/domains${qs(params)}`),
  domain: (id) => http(`/api/domains/${encodeURIComponent(id)}`),
  participants: (id, ip) => http(`/api/domains/${encodeURIComponent(id)}/participants${ip ? '?ip=' + encodeURIComponent(ip) : ''}`),
  participant: (guid, domainId) => http(`/api/participants/${encodeURIComponent(guid)}${domainId ? '?domainId=' + encodeURIComponent(domainId) : ''}`),
  topics: (id, name) => http(`/api/domains/${encodeURIComponent(id)}/topics${name ? '?name=' + encodeURIComponent(name) : ''}`),
  topic: (id, name) => http(`/api/domains/${encodeURIComponent(id)}/topics/${encodeURIComponent(name)}`),
  topicCompatibility: (id, name) => http(`/api/domains/${encodeURIComponent(id)}/topics/${encodeURIComponent(name)}/compatibility`),
  ips: (domainId) => http(`/api/ips${domainId ? '?domainId=' + encodeURIComponent(domainId) : ''}`),

  // ---- 单文件导入 + 节点关系 / 主题↔IP 对应 ----
  importFile: (file, name) => fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': name || file.name },
    body: file,
  }).then(async (res) => {
    const body = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || body.ok === false) throw new Error((body.error && body.error.message) || `导入失败 ${res.status}`);
    return body;
  }),
  relations: (id) => http(`/api/domains/${encodeURIComponent(id)}/relations`),
  ipTopics: (id) => http(`/api/domains/${encodeURIComponent(id)}/ip-topics`),
  ipDetail: (id, ip) => http(`/api/domains/${encodeURIComponent(id)}/ips/${encodeURIComponent(ip)}`),
  ipInteractions: (id, ip) => http(`/api/domains/${encodeURIComponent(id)}/ips/${encodeURIComponent(ip)}/interactions`),

  // ---- IP 节点别名（需求 3） ----
  aliases: () => http('/api/aliases'),
  setAlias: (ip, alias) => http('/api/aliases', { method: 'PUT', body: JSON.stringify({ ip, alias }) }),
  deleteAlias: (ip) => http(`/api/aliases/${encodeURIComponent(ip)}`, { method: 'DELETE' }),
};

// 订阅 SSE，返回 { close }。handler(event, data)
export function subscribe(handlers) {
  const es = new EventSource('/api/events');
  const events = ['hello', 'snapshot', 'records', 'stats', 'watcher', 'alert', 'heartbeat', 'domains', 'domainDetail', 'compatibility'];
  for (const ev of events) {
    es.addEventListener(ev, (e) => {
      let data = null;
      try { data = JSON.parse(e.data); } catch (_) { data = e.data; }
      if (handlers[ev]) handlers[ev](data);
    });
  }
  es.onerror = () => {
    if (handlers.onState) handlers.onState('reconnecting');
  };
  es.onopen = () => {
    if (handlers.onState) handlers.onState('connected');
  };
  return { close: () => es.close() };
}
