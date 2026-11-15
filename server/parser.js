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

function normalizeStatus(raw, statusMapping) {
  if (raw == null || raw === '') return 'OK';
  const r = String(raw).trim();
  const upper = r.toUpperCase();
  for (const [norm, values] of Object.entries(statusMapping || {})) {
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

// 提取 topic 列表：优先别名命中的单 topic（LJDDS endpoint），
// 否则查找结构中的 topics/topic 容器（PRD 示例 schema）。
function extractTopics(merged, std, aliases, maxTopics) {
  const topics = [];
  const topicName = std.topic;
  const topicType = std.type;
  if (topicName != null && topicName !== '') {
    topics.push({ name: String(topicName), type: topicType != null ? String(topicType) : null });
  }
  // 兜底：对象中的 topics 容器
  const container = findTopicsContainer(merged, aliases.topic);
  for (const t of container) {
    if (topics.length >= maxTopics) break;
    const name = pick(t, aliases.topic) || pickAttr(t, 'name');
    const type = pick(t, aliases.type) || pickAttr(t, 'type');
    const sampleCount = pickAttr(t, 'sampleCount') || pickAttr(t, 'count') || null;
    if (name != null && !topics.some((x) => x.name === name)) {
      topics.push({ name: String(name), type: type != null ? String(type) : null, sampleCount });
    }
  }
  return topics.slice(0, maxTopics);
}

function findTopicsContainer(obj, topicAliases) {
  if (!obj || typeof obj !== 'object') return [];
  // 直接字段名匹配 topics（大小写不敏感）
  const key = Object.keys(obj).find((k) => k.toLowerCase() === 'topics');
  if (key) {
    const inner = obj[key];
    const list = inner && typeof inner === 'object' && !Array.isArray(inner) ? toArray(inner.topic) : [];
    return list;
  }
  return [];
}

function pick(obj, aliases) {
  if (!obj || typeof obj !== 'object') return undefined;
  const entries = Object.entries(obj);
  for (const [k, v] of entries) {
    const kk = k.replace(/^@_/, '').toLowerCase();
    if (aliases.some((a) => String(a).toLowerCase() === kk)) return v;
  }
  return undefined;
}
function pickAttr(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj[`@_${name}`] !== undefined) return obj[`@_${name}`];
  if (obj[name] !== undefined) return obj[name];
  return undefined;
}

// 从 DDS RTPS GUID（HostId=IP,AppId=…）中解析节点主机地址。
// LJDDS 的 endpoint 元素没有 host 字段，主机信息只存在于 guid 中。
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
    allowBooleanAttributes: true,
    parseTagValue: false,       // 保持值为字符串，避免 "00000402" 被转成数字
    parseAttributeValue: false,
    trimValues: false,
    cdataPropName: '#cdata',
    textNodeName: '#text',
  });

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
  function buildRecord({ kind, obj, context }, fileMeta, idx) {
    const merged = Object.assign({}, context, obj);
    const metrics = {};
    flatten(merged, '', metrics);

    // 容量裁剪
    const metricsList = Object.entries(metrics);
    const trimmed = {};
    for (const [k, v] of metricsList.slice(0, config.maxMetricsPerRecord)) trimmed[k] = v;

    const std = extractStandardFields(trimmed, config.fieldAliases || {});

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

    const topics = extractTopics(merged, std, config.fieldAliases || {}, config.maxTopicsPerRecord);

    const seq = std.seq != null ? String(std.seq) : null;
    let node = std.node != null ? String(std.node) : 'unknown';
    if (node === 'unknown' || !node) node = extractHostFromGuid(trimmed) || 'unknown';
    const domain = std.domain != null ? String(std.domain) : '0';
    const typeName = std.type != null ? String(std.type) : null;

    // 幂等键：文件路径 + mtimeMs + size + seq + 文件内序号
    const idSrc = `${fileMeta.filePath}|${fileMeta.mtimeMs}|${fileMeta.size}|${seq ?? ''}|${idx}`;
    const id = crypto.createHash('sha1').update(idSrc).digest('hex').slice(0, 20);

    return {
      id,
      receivedAt: fileMeta.receivedAt,
      timestampIso,
      timestampRaw,
      node,
      domain,
      seq,
      status,
      statusRaw,
      kind,
      typeName,
      rootName: 'root',
      topics,
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

    return records.map((r, i) =>
      buildRecord(r, {
        filePath: fileMeta.filePath,
        fileName: fileMeta.fileName,
        size: buffer.length,
        mtimeMs: fileMeta.mtimeMs,
        mtimeIso: fileMeta.mtimeIso,
        receivedAt: fileMeta.receivedAt,
        rawXml: rawXmlPreview,
        xmlTruncated: xml.length > config.maxXmlPreviewBytes,
        parseMs,
      }, i)
    ).map((rec) => {
      rec.rootName = rootName;
      return rec;
    });
  }

  return { parse, decodeBuffer, flatten, extractStandardFields, normalizeStatus, normalizeTimestamp };
}

module.exports = { createParser, decodeBuffer, flatten, extractStandardFields, normalizeStatus, normalizeTimestamp, INCOMPLETE_XML, FILE_TOO_LARGE };
