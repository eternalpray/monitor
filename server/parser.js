'use strict';

const crypto = require('crypto');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const iconv = require('iconv-lite');

const INCOMPLETE_XML = 'INCOMPLETE_XML';
const FILE_TOO_LARGE = 'FILE_TOO_LARGE';

// ---------------------------------------------------------------------------
// 编码检测：PRD 约定输入 UTF-8，但现场采集节点常输出 GBK/GB18030。
// 策略：BOM 优先 → 严格 UTF-8 校验 → 失败则按 GB18030（GBK 超集）解码。
// ---------------------------------------------------------------------------
function decodeBuffer(buf) {
  if (!buf || !buf.length) return '';
  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  // UTF-16 LE / BE BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf);
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i]; swapped[i] = swapped[i + 1]; swapped[i + 1] = t;
    }
    return swapped.slice(2).toString('utf16le');
  }
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('�')) return utf8; // 有效 UTF-8
  return iconv.decode(buf, 'gb18030'); // 兜底：GBK/GB2312
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function toArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function getByPath(obj, pathStr) {
  const segs = String(pathStr).split('.');
  let cur = obj;
  for (const s of segs) {
    if (cur == null) return undefined;
    cur = cur[s];
  }
  return cur;
}

// 将解析后的对象树扁平化为「点路径 → 标量值」，属性去掉 @_ 前缀。
function flatten(node, prefix, out) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const x of node) flatten(x, prefix, out);
    return;
  }
  if (typeof node !== 'object') {
    out[prefix] = node;
    return;
  }
  const rawText = node['#text'];
  const text = typeof rawText === 'string' ? rawText.trim() : rawText;
  const hasText = text !== undefined && text !== '';
  const attrKeys = Object.keys(node).filter((k) => k.startsWith('@_'));
  const childKeys = Object.keys(node).filter(
    (k) => !k.startsWith('@_') && k !== '#text' && k !== '#cdata' && k !== '#comment'
  );
  if (hasText) out[prefix] = text;
  for (const k of attrKeys) {
    const v = node[k];
    if (v === undefined) continue;
    const key = prefix ? `${prefix}.${k.slice(2)}` : k.slice(2);
    if (typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  for (const k of childKeys) {
    const key = prefix ? `${prefix}.${k}` : k;
    flatten(node[k], key, out);
  }
}

function isNumeric(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return s !== '' && !Number.isNaN(Number(s));
}

// ---------------------------------------------------------------------------
// 结构提取辅助：大小写不敏感地按键名查找对象/子对象，兼容属性与 #text。
// ---------------------------------------------------------------------------
function isKey(k, names) {
  const kk = String(k).replace(/^@_/, '').toLowerCase();
  return names.some((n) => String(n).toLowerCase() === kk);
}

// 从对象中按多个候选名取值：先属性（@_name），再子元素 #text / @_value，再标量。
function getVal(obj, names) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  for (const n of names) {
    const ak = '@_' + n;
    if (obj[ak] !== undefined && obj[ak] !== null && typeof obj[ak] !== 'object') return obj[ak];
    const direct = obj[n];
    if (direct === undefined || direct === null) continue;
    if (Array.isArray(direct)) continue;
    if (typeof direct === 'object') {
      if (direct['#text'] !== undefined) return direct['#text'];
      if (direct['@_value'] !== undefined) return direct['@_value'];
      continue;
    }
    return direct;
  }
  return undefined;
}

// 深度优先查找首个键名匹配 names 的容器（返回其值）。
function findContainer(obj, names) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const r = findContainer(x, names);
      if (r != null) return r;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === '#text' || k === '#cdata' || k === '#comment' || k.startsWith('@_')) continue;
    if (isKey(k, names)) return v;
    const r = findContainer(v, names);
    if (r != null) return r;
  }
  return null;
}

// 收集容器内所有键名匹配 names 的子对象（数组自动展开，仅展开一层）。
function collectItems(container, names) {
  const out = [];
  if (container == null) return out;
  const add = (v) => {
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === 'object') out.push(x);
    } else if (v && typeof v === 'object') {
      out.push(v);
    }
  };
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === '#text' || k === '#cdata' || k === '#comment' || k.startsWith('@_')) continue;
      if (isKey(k, names)) { add(v); continue; }
      walk(v);
    }
  };
  if (Array.isArray(container)) {
    for (const x of container) walk(x);
  } else {
    walk(container);
  }
  return out;
}

// ---------------------------------------------------------------------------
// QoS 归一（FR-02-13，7.6）：统一为大写枚举或毫秒数值，无法识别保留原值。
// ---------------------------------------------------------------------------
const QOS_ENUM_ALIASES = {
  reliability: { BEST_EFFORT: 'BEST_EFFORT', BESTEFFORT: 'BEST_EFFORT', 'BEST-EFFORT': 'BEST_EFFORT', RELIABLE: 'RELIABLE' },
  durability: { VOLATILE: 'VOLATILE', TRANSIENT_LOCAL: 'TRANSIENT_LOCAL', 'TRANSIENT-LOCAL': 'TRANSIENT_LOCAL', TRANSIENT: 'TRANSIENT', PERSISTENT: 'PERSISTENT' },
  liveliness: { AUTOMATIC: 'AUTOMATIC', MANUAL_BY_PARTICIPANT: 'MANUAL_BY_PARTICIPANT', MANUAL: 'MANUAL_BY_PARTICIPANT', MANUAL_BY_TOPIC: 'MANUAL_BY_TOPIC' },
  ownership: { SHARED: 'SHARED', EXCLUSIVE: 'EXCLUSIVE' },
};

const QOS_KEYS = {
  reliability: ['reliability', 'reliable'],
  durability: ['durability', 'durabilityKind'],
  liveliness: ['liveliness', 'livelinessKind'],
  ownership: ['ownership', 'ownershipKind'],
  deadline: ['deadlineMs', 'deadline', 'deadlinePeriod', 'deadline_ms', 'deadline_period', 'deadlinePeriodMs'],
  livelinessLease: ['livelinessLease', 'liveliness_lease', 'leaseDuration', 'lease_duration', 'livelinessLeaseDuration'],
  partition: ['partition', 'partitions', 'partitionName', 'partition_name'],
};

function normEnum(raw, dimension) {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const up = s.toUpperCase();
  const map = QOS_ENUM_ALIASES[dimension] || {};
  if (map[up]) return map[up];
  return s; // 无法识别 → 保留原值（调用方标记未标准化）
}

function normalizePartition(raw) {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    const arr = raw.map((x) => String(x).trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }
  const s = String(raw).trim();
  if (!s) return undefined;
  // 逗号 / 空格分隔的多分区
  const parts = s.split(/[,;|\s]+/).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : [s];
}

function normalizeQos(obj) {
  const qos = {};
  if (!obj || typeof obj !== 'object') return qos;
  for (const dim of ['reliability', 'durability', 'liveliness', 'ownership']) {
    const v = normEnum(getVal(obj, QOS_KEYS[dim]), dim);
    if (v !== undefined) qos[dim] = v;
  }
  const dl = getVal(obj, QOS_KEYS.deadline);
  if (dl != null && String(dl).toUpperCase() !== 'INF') {
    qos.deadline = isNumeric(dl) ? Number(dl) : String(dl);
  } else if (dl != null) {
    qos.deadline = 'INF';
  }
  const ll = getVal(obj, QOS_KEYS.livelinessLease);
  if (ll != null && String(ll).toUpperCase() !== 'INF') {
    qos.livelinessLease = isNumeric(ll) ? Number(ll) : String(ll);
  } else if (ll != null) {
    qos.livelinessLease = 'INF';
  }
  const part = normalizePartition(getVal(obj, QOS_KEYS.partition));
  if (part !== undefined) qos.partition = part;
  return qos;
}

function getQosObj(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.qos && typeof obj.qos === 'object' && !Array.isArray(obj.qos)) return obj.qos;
  return null;
}

// ---------------------------------------------------------------------------
// IP 提取与校验（FR-02-14）
// ---------------------------------------------------------------------------
function isValidIp(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s) return false;
  const m4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) return m4.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
  let t = s.replace(/^\[|\]$/g, '');
  if (t.includes(':')) {
    return /^[0-9a-fA-F:.]+$/.test(t) && t.split('::').length <= 2;
  }
  return false;
}

function ipFromGuid(guid) {
  if (!guid) return null;
  const m = String(guid).match(/HostId=([^,\s]+)/i);
  if (m && isValidIp(m[1])) return m[1];
  return null;
}

// 取合法 IP：优先显式 ip → guid 中 HostId → 非法值丢弃并记录。
function cleanIp(obj, guid, dropped, ctx) {
  const raw = getVal(obj, ['ip', 'address', 'ipAddress', 'hostAddress', 'addr', 'unicast', 'locator']);
  const candidate = raw != null ? String(raw).trim() : ipFromGuid(guid);
  if (candidate == null || candidate === '') return null;
  if (isValidIp(candidate)) return candidate;
  if (dropped) dropped.push({ field: 'ip', value: candidate, reason: 'INVALID_IP', where: ctx || 'endpoint' });
  return null;
}

// ---------------------------------------------------------------------------
// 参与者 / 端点提取（FR-02-11 / FR-02-12）
// ---------------------------------------------------------------------------
function buildParticipant(obj, aliases, dropped) {
  const guid = getVal(obj, ['guid', 'participantGuid', 'participantId', 'guidPrefix', 'id']);
  const name = getVal(obj, ['name', 'participantName', 'entity_name', 'participant']);
  const host = getVal(obj, ['host', 'hostname', 'hostName']);
  const pid = getVal(obj, ['pid', 'process_id', 'processId']);
  const statusRaw = getVal(obj, ['status', 'state', 'health', 'online']);
  const ip = cleanIp(obj, guid, dropped, 'participant');
  const qos = normalizeQos(getQosObj(obj));
  if (!guid && !name && !ip) return null;
  return {
    guid: guid != null ? String(guid) : null,
    name: name != null ? String(name) : null,
    ip,
    host: host != null ? String(host) : null,
    pid: pid != null ? String(pid) : null,
    status: normalizeStatus(statusRaw),
    statusRaw: statusRaw != null ? String(statusRaw) : null,
    qos,
  };
}

function detectRole(obj) {
  const t = getVal(obj, ['endpoint_type', 'endpointType', 'role', 'kind', 'direction']);
  if (t == null) return null;
  const s = String(t).toLowerCase();
  if (/writer|publisher|pub|sender|dw|datawriter/.test(s)) return 'writer';
  if (/reader|subscriber|sub|receiver|dr|datareader/.test(s)) return 'reader';
  return null;
}

function buildEndpoint(obj, role, topicName, typeName, aliases, dropped) {
  const guid = getVal(obj, ['guid', 'endpointGuid', 'endpoint_guid', 'id']);
  const participantGuid = getVal(obj, ['participantGuid', 'participant_guid', 'pubsub_guid', 'pubsubGuid']);
  const statusRaw = getVal(obj, ['status', 'state']);
  const ip = cleanIp(obj, guid, dropped, 'endpoint');
  const sampleRate = getVal(obj, ['sampleRate', 'sample_rate', 'sampleRateHz']);
  const qos = normalizeQos(getQosObj(obj));
  return {
    guid: guid != null ? String(guid) : null,
    role,
    topic: topicName != null ? String(topicName) : null,
    type: typeName != null ? String(typeName) : null,
    ip,
    participantGuid: participantGuid != null ? String(participantGuid) : null,
    qos,
    status: normalizeStatus(statusRaw),
    statusRaw: statusRaw != null ? String(statusRaw) : null,
    sampleRate: isNumeric(sampleRate) ? Number(sampleRate) : (sampleRate != null ? String(sampleRate) : null),
  };
}

function extractParticipants(doc, aliases, dropped) {
  const items = [];
  const pc = findContainer(doc, ['participants']);
  items.push(...collectItems(pc, ['participant', 'domainParticipant', 'element']));
  if (!items.length) {
    const p2 = findContainer(doc, ['participant']);
    items.push(...collectItems(p2, ['element', 'participant', 'domainParticipant']));
  }
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const p = buildParticipant(it, aliases, dropped);
    if (!p) continue;
    const key = p.guid || (p.ip && p.name ? `${p.ip}|${p.name}` : null);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(p);
  }
  return out;
}

function extractEndpoints(doc, aliases, dropped) {
  const out = [];
  const seen = new Set();
  const push = (e) => {
    if (!e) return;
    const key = e.guid || `${e.participantGuid || ''}|${e.topic || ''}|${e.role}`;
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(e);
  };

  // 1) 嵌套在 topics 容器内的 writers/readers（PRD 附录 C schema）
  //    兼容两种写法：<writers><writer/></writers> 或 直接 <writer/> 挂 topic 下
  const topicsContainer = findContainer(doc, ['topics']);
  const topicItems = collectItems(topicsContainer, ['topic']);
  for (const t of topicItems) {
    const topicName = getVal(t, ['name', 'topicName', 'topic_name', 'topic']);
    const typeName = getVal(t, ['type', 'typeName', 'topicType', 'type_name', 'dataType']);
    const { writers, readers } = collectTopicEndpoints(t);
    for (const w of writers) push(buildEndpoint(w, 'writer', topicName, typeName, aliases, dropped));
    for (const r of readers) push(buildEndpoint(r, 'reader', topicName, typeName, aliases, dropped));
  }

  // 2) 扁平 endpoint 列表（LJDDS schema）
  const flatContainer = findContainer(doc, ['endpoints', 'endpoint']);
  const flatItems = collectItems(flatContainer, ['element', 'endpoint', 'writer', 'reader', 'dataWriter', 'dataReader']);
  for (const it of flatItems) {
    const role = detectRole(it);
    if (!role) continue;
    const topicName = getVal(it, ['topicName', 'topic_name', 'topic']);
    const typeName = getVal(it, ['typeName', 'type_name', 'type', 'dataType']);
    push(buildEndpoint(it, role, topicName, typeName, aliases, dropped));
  }
  return out;
}

// 收集某个 topic 对象下的 writer/reader 端点，兼容包裹容器与直接子元素两种结构。
function collectTopicEndpoints(topic) {
  const writers = [];
  const readers = [];
  if (!topic || typeof topic !== 'object') return { writers, readers };
  const add = (v, arr) => {
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x === 'object') arr.push(x); }
    else if (v && typeof v === 'object') arr.push(v);
  };
  for (const [k, v] of Object.entries(topic)) {
    if (k.startsWith('@_') || k === '#text' || k === '#cdata' || k === '#comment') continue;
    const kk = k.toLowerCase();
    if (kk === 'writers') { for (const w of collectItems(v, ['writer', 'dataWriter', 'publisher', 'pub', 'element'])) writers.push(w); }
    else if (kk === 'readers') { for (const r of collectItems(v, ['reader', 'dataReader', 'subscriber', 'sub', 'element'])) readers.push(r); }
    else if (kk === 'writer' || kk === 'datawriter' || kk === 'publisher' || kk === 'pub') add(v, writers);
    else if (kk === 'reader' || kk === 'datareader' || kk === 'subscriber' || kk === 'sub') add(v, readers);
  }
  return { writers, readers };
}

// ---------------------------------------------------------------------------
// 标准字段别名匹配：在扁平化 keys 上按「末段 / 次末段」匹配别名（大小写不敏感）。
// ---------------------------------------------------------------------------
function extractStandardFields(metrics, fieldAliases) {
  const entries = Object.entries(metrics);
  const lookup = (aliases) => {
    for (const [key, val] of entries) {
      const segs = String(key).toLowerCase().split('.').map((s) => s.trim());
      const last = segs[segs.length - 1];
      const parent = segs.length >= 2 ? segs[segs.length - 2] : '';
      for (const a of aliases) {
        const al = String(a).toLowerCase();
        if (last === al) return val;
        if (parent === al) return val;
      }
    }
    return undefined;
  };
  const out = {};
  for (const field of Object.keys(fieldAliases)) {
    const v = lookup(fieldAliases[field]);
    if (v !== undefined) out[field] = v;
  }
  return out;
}

const STATUS_MAP = {
  OK: ['OK', 'ALIVE', 'RUNNING', 'HEALTHY', 'NORMAL', 'PASS', 'ACTIVE', 'GOOD', 'ONLINE', '1', 'true'],
  WARN: ['WARN', 'WARNING', 'DEGRADED', 'TIMEOUT', 'STALE', 'SLOW', '2'],
  ERROR: ['ERROR', 'FAULT', 'FAILED', 'FAIL', 'DOWN', 'CRITICAL', 'OFFLINE', 'LOST', 'FATAL', '0', 'false'],
};

function normalizeStatus(raw, mapping) {
  if (raw == null || raw === '') return 'OK';
  const r = String(raw).trim();
  const upper = r.toUpperCase();
  const map = mapping && Object.keys(mapping).length ? mapping : STATUS_MAP;
  for (const [norm, values] of Object.entries(map)) {
    if (values.some((v) => String(v).toUpperCase() === upper)) return norm;
  }
  return 'UNKNOWN';
}

// 将常见时间串归一为 ISO 8601（无时区则保持朴素本地时间，仅替换分隔符）。
function normalizeTimestamp(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // 已含 T 或 Z / 时区偏移则原样
  if (/\d{4}-\d{2}-\d{2}T/.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /Z$/i.test(s)) return s;
  // "2026-10-26 16:45:32" → "2026-10-26T16:45:32"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/);
  if (m) return `${m[1]}T${m[2]}${m[3] ? '.' + m[3] : ''}`;
  // 时间戳数字（秒/毫秒）
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

// 提取 topic 列表（v1.1 扩展）：含 partition、qos、计数与样本速率。
function extractTopics(merged, std, aliases, maxTopics, dropped) {
  const topics = [];
  const seen = new Set();
  const addTopic = (t) => {
    if (!t || !t.name) return;
    const key = `${t.name}|${t.type || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (topics.length >= maxTopics) return;
    topics.push(t);
  };

  const topicName = std.topic;
  const topicType = std.type;
  if (topicName != null && topicName !== '') {
    addTopic({ name: String(topicName), type: topicType != null ? String(topicType) : null });
  }

  // 容器兜底：topics/topic
  const container = findContainer(merged, ['topics']);
  for (const t of collectItems(container, ['topic'])) {
    if (topics.length >= maxTopics) break;
    const name = getVal(t, ['name', 'topicName', 'topic_name', 'topic']) || getVal(t, ['@_name']);
    const type = getVal(t, ['type', 'typeName', 'topicType', 'type_name', 'dataType']);
    const partition = normalizePartition(getVal(t, ['partition', 'partitions', 'partitionName']));
    const sampleCount = getVal(t, ['sampleCount', 'sample_count', 'count']);
    const writerCount = getVal(t, ['writerCount', 'writer_count']);
    const readerCount = getVal(t, ['readerCount', 'reader_count']);
    const qos = normalizeQos(getQosObj(t));
    addTopic({
      name: name != null ? String(name) : null,
      type: type != null ? String(type) : null,
      partition: partition !== undefined ? partition : undefined,
      qos,
      sampleCount: sampleCount != null ? (isNumeric(sampleCount) ? Number(sampleCount) : String(sampleCount)) : null,
      writerCount: writerCount != null ? Number(writerCount) : null,
      readerCount: readerCount != null ? Number(readerCount) : null,
    });
  }
  return topics.slice(0, maxTopics);
}

// 从 DDS RTPS GUID（HostId=IP,AppId=…）中解析节点主机地址。
function extractHostFromGuid(metrics) {
  const order = ['guid', 'pubsub_guid'];
  for (const k of order) {
    if (metrics[k] != null) {
      const m = String(metrics[k]).match(/HostId=([^,\s]+)/i);
      if (m) return m[1];
    }
  }
  for (const [k, v] of Object.entries(metrics)) {
    if (!/guid/i.test(k)) continue;
    const m = String(v).match(/HostId=([^,\s]+)/i);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// 主解析器
// ---------------------------------------------------------------------------
function createParser(config) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    ignoreDeclaration: true,
    allowBooleanAttributes: true,
    parseTagValue: false,       // 保持值为字符串，避免 "00000402" 被转成数字
    parseAttributeValue: false,
    trimValues: false,
    cdataPropName: '#cdata',
    textNodeName: '#text',
  });

  const aliases = config.fieldAliases || {};

  // 按 split 配置把整棵树拆成记录子对象，并继承父级上下文
  function splitRecords(tree) {
    const split = config.split;
    if (!split || !split.enabled || !Array.isArray(split.recordPaths) || !split.recordPaths.length) {
      return [{ kind: 'snapshot', obj: tree, context: {} }];
    }
    const records = [];
    for (const spec of split.recordPaths) {
      const arr = getByPath(tree, spec.path);
      if (arr == null) continue;
      const list = toArray(arr);
      for (const el of list) {
        if (!el || typeof el !== 'object') continue;
        const context = {};
        for (const c of split.context || []) {
          const v = getByPath(tree, c.from);
          if (v !== undefined) context[c.as] = v;
        }
        records.push({ kind: spec.kind || 'record', obj: el, context });
      }
    }
    if (!records.length) return [{ kind: 'snapshot', obj: tree, context: {} }];
    return records;
  }

  // 单条记录：合并上下文 → 扁平化 → 标准字段 → 组装 Record
  function buildRecord({ kind, obj, context }, fileMeta, idx, docParticipants, docEndpoints, dropped) {
    const merged = Object.assign({}, context, obj);
    const metrics = {};
    flatten(merged, '', metrics);

    // 容量裁剪
    const metricsList = Object.entries(metrics);
    const trimmed = {};
    for (const [k, v] of metricsList.slice(0, config.maxMetricsPerRecord)) trimmed[k] = v;

    const std = extractStandardFields(trimmed, aliases);

    const numericMetrics = {};
    for (const [k, v] of Object.entries(trimmed)) {
      if (!isNumeric(v)) continue;
      const last = k.split('.').pop().toLowerCase();
      if ((config.numericMetricExclude || []).includes(last)) continue;
      numericMetrics[k] = Number(v);
    }

    const timestampRaw = std.timestamp != null ? String(std.timestamp) : null;
    const timestampIso = normalizeTimestamp(timestampRaw || fileMeta.mtimeIso);

    const statusRaw = std.status != null ? String(std.status) : null;
    const status = normalizeStatus(statusRaw, config.statusMapping);

    const topics = extractTopics(merged, std, aliases, config.maxTopicsPerRecord, dropped);

    const seq = std.seq != null ? String(std.seq) : null;
    let node = std.node != null ? String(std.node) : 'unknown';
    if (node === 'unknown' || !node) node = extractHostFromGuid(trimmed) || 'unknown';
    const domain = std.domain != null ? String(std.domain) : '0';
    const typeName = std.type != null ? String(std.type) : null;

    // 幂等键：文件路径 + mtimeMs + size + seq + 文件内序号
    const idSrc = `${fileMeta.filePath}|${fileMeta.mtimeMs}|${fileMeta.size}|${seq ?? ''}|${idx}`;
    const id = crypto.createHash('sha1').update(idSrc).digest('hex').slice(0, 20);

    // 文档级参与者/端点仅在首条记录上挂载，避免 LJDDS 拆分多记录时重复
    const isFirst = idx === 0;

    return {
      id,
      receivedAt: fileMeta.receivedAt,
      timestampIso,
      timestampRaw,
      node,
      domain,
      domainId: domain,
      seq,
      status,
      statusRaw,
      kind,
      typeName,
      rootName: 'root',
      topics,
      participants: isFirst ? docParticipants : [],
      endpoints: isFirst ? docEndpoints : [],
      droppedFields: isFirst ? dropped : [],
      metrics: trimmed,
      numericMetrics,
      fileName: fileMeta.fileName,
      filePath: fileMeta.filePath,
      fileSize: fileMeta.size,
      fileMtime: fileMeta.mtimeIso,
      raw: obj,
      rawXml: fileMeta.rawXml,
      xmlTruncated: fileMeta.xmlTruncated,
      parseMs: fileMeta.parseMs,
    };
  }

  // 入口：Buffer → Record[]
  function parse(buffer, fileMeta) {
    if (buffer.length > config.maxFileSize) {
      const err = new Error(`文件超过大小上限 ${config.maxFileSize} 字节`);
      err.code = FILE_TOO_LARGE;
      throw err;
    }
    const start = Date.now();
    const xml = decodeBuffer(buffer);

    const valid = XMLValidator.validate(xml);
    if (valid !== true) {
      const err = new Error(valid && valid.err ? valid.err.msg : 'XML 不完整或结构错误');
      err.code = INCOMPLETE_XML;
      throw err;
    }

    const tree = parser.parse(xml);
    const rootName = Object.keys(tree)[0] || 'root';
    // 拆掉根元素，使 split/context 路径相对文档根、不绑定具体根标签名（更通用）
    const doc = tree[rootName] || tree;
    const records = splitRecords(doc);
    const parseMs = Date.now() - start;

    const rawXmlPreview = xml.length > config.maxXmlPreviewBytes
      ? xml.slice(0, config.maxXmlPreviewBytes)
      : xml;

    // 文档级提取（FR-02-11~14）：从整棵文档树提取参与者/端点，收集非法值
    const dropped = [];
    const docParticipants = extractParticipants(doc, aliases, dropped).slice(0, config.maxParticipantsPerRecord);
    const docEndpoints = extractEndpoints(doc, aliases, dropped).slice(0, config.maxEndpointsPerRecord);

    const fileMetaFull = {
      filePath: fileMeta.filePath,
      fileName: fileMeta.fileName,
      size: buffer.length,
      mtimeMs: fileMeta.mtimeMs,
      mtimeIso: fileMeta.mtimeIso,
      receivedAt: fileMeta.receivedAt,
      rawXml: rawXmlPreview,
      xmlTruncated: xml.length > config.maxXmlPreviewBytes,
      parseMs,
    };

    return records
      .map((r, i) => buildRecord(r, fileMetaFull, i, docParticipants, docEndpoints, dropped))
      .map((rec) => {
        rec.rootName = rootName;
        return rec;
      });
  }

  return { parse, decodeBuffer, flatten, extractStandardFields, normalizeStatus, normalizeTimestamp };
}

module.exports = {
  createParser,
  decodeBuffer,
  flatten,
  extractStandardFields,
  normalizeStatus,
  normalizeTimestamp,
  normalizeQos,
  isValidIp,
  INCOMPLETE_XML,
  FILE_TOO_LARGE,
};
