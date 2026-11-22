'use strict';

const { evaluateCompatibility, aggregateVerdict } = require('./compatibility');

// ---------------------------------------------------------------------------
// 域 / 参与者 / 主题 / 端点聚合视图（PRD 10.4）：按 domainId 分桶，增量更新、窗口裁剪。
// 数据来源为每份记录上的 participants[] / endpoints[] / topics[]（FR-02-11~15）。
// ---------------------------------------------------------------------------

function topicKey(name, type) {
  return `${name || ''}|${type || ''}`;
}

class Aggregator {
  constructor(configManager) {
    this.configManager = configManager;
    this.buckets = new Map(); // domainId -> bucket
    this._recordSeq = 0;
    this._revision = 0;
    this._compatCache = new Map(); // `${domainId}|${topicKey}|${topicRev}` -> compat result
  }

  _cfg() {
    return this.configManager.get();
  }

  _newBucket(domainId) {
    return {
      domainId,
      participants: new Map(), // dedupKey -> entry
      endpoints: new Map(),    // dedupKey -> entry
      topics: new Map(),       // name|type -> entry
      ips: new Set(),
      recentTs: [],            // 近 1 分钟记录时间戳（有界）
      lastUpdate: null,
      topicRev: new Map(),     // name|type -> 端点变更版本号
    };
  }

  // 增量摄入一条记录
  add(record) {
    const domainId = record.domainId != null ? String(record.domainId) : (record.domain != null ? String(record.domain) : '0');
    if (!this.buckets.has(domainId)) this.buckets.set(domainId, this._newBucket(domainId));
    const bucket = this.buckets.get(domainId);
    const now = Date.now();
    this._recordSeq++;

    for (const p of record.participants || []) {
      this._putParticipant(bucket, p, now);
    }
    for (const e of record.endpoints || []) {
      this._putEndpoint(bucket, e, now);
    }
    for (const t of record.topics || []) {
      if (t && t.name != null) this._putTopic(bucket, t, now);
    }

    bucket.recentTs.push(now);
    if (bucket.recentTs.length > 1000) bucket.recentTs.splice(0, bucket.recentTs.length - 1000);
    bucket.lastUpdate = new Date(now).toISOString();
    this._revision++;
    // 窗口裁剪（时间 + 条数）
    this._prune(bucket, now);
  }

  _putParticipant(bucket, p, now) {
    const dedupKey = p.guid || `${bucket.domainId}|${p.ip || ''}|${p.name || ''}`;
    if (!dedupKey || dedupKey === `${bucket.domainId}||`) return;
    const existing = bucket.participants.get(dedupKey);
    const entry = Object.assign({}, p, {
      dedupKey,
      lastSeenMs: now,
      seq: this._recordSeq,
    });
    // 用新值覆盖旧值，但保留最早缺失的字段（不臆造）
    if (existing) {
      for (const k of ['guid', 'name', 'ip', 'host', 'pid', 'status', 'statusRaw']) {
        if (entry[k] == null && existing[k] != null) entry[k] = existing[k];
      }
      entry.qos = Object.assign({}, existing.qos, entry.qos);
    }
    bucket.participants.set(dedupKey, entry);
    if (entry.ip) bucket.ips.add(entry.ip);
  }

  _putEndpoint(bucket, e, now) {
    const dedupKey = e.guid || `${e.participantGuid || ''}|${e.topic || ''}|${e.role}`;
    if (!dedupKey || dedupKey === `||`) return;
    const existing = bucket.endpoints.get(dedupKey);
    const entry = Object.assign({}, e, { dedupKey, lastSeenMs: now, seq: this._recordSeq });
    if (existing) {
      for (const k of ['guid', 'role', 'topic', 'type', 'ip', 'participantGuid', 'status', 'statusRaw', 'sampleRate']) {
        if (entry[k] == null && existing[k] != null) entry[k] = existing[k];
      }
      entry.qos = Object.assign({}, existing.qos, entry.qos);
    }
    bucket.endpoints.set(dedupKey, entry);
    if (entry.ip) bucket.ips.add(entry.ip);
    if (entry.topic) {
      const tk = topicKey(entry.topic, entry.type);
      bucket.topicRev.set(tk, (bucket.topicRev.get(tk) || 0) + 1);
      // 兜底：端点带出的主题也登记为 topic（schema 无独立 topics 容器时主题视图不空）
      const existingTopic = bucket.topics.get(tk);
      if (!existingTopic) {
        bucket.topics.set(tk, { name: entry.topic, type: entry.type, key: tk, lastSeenMs: now, seq: this._recordSeq, qos: {} });
      } else {
        existingTopic.lastSeenMs = now;
        existingTopic.seq = this._recordSeq;
        if (existingTopic.type == null && entry.type != null) existingTopic.type = entry.type;
      }
    }
  }

  _putTopic(bucket, t, now) {
    const key = topicKey(t.name, t.type);
    const existing = bucket.topics.get(key);
    const entry = Object.assign({}, t, { key, lastSeenMs: now, seq: this._recordSeq });
    if (existing) {
      for (const k of ['name', 'type', 'partition', 'sampleCount', 'writerCount', 'readerCount']) {
        if (entry[k] == null && existing[k] != null) entry[k] = existing[k];
      }
      entry.qos = Object.assign({}, existing.qos, entry.qos);
    }
    bucket.topics.set(key, entry);
  }

  // 窗口裁剪：超出时间窗的参与者/端点/主题移除。
  // 时间窗为唯一判据：实体按 guid/ip/name 去重，天然有界，无需按记录条数硬裁
  // （按条数裁剪会把「同文件拆分出的多条记录」误判为历史数据，导致参与者被过早淘汰）。
  _prune(bucket, now) {
    const winSec = (this._cfg().domainWindowSec || 300) * 1000;
    const timeCutoff = now - winSec;

    const pruneMap = (map) => {
      for (const [k, v] of map) {
        if (v.lastSeenMs < timeCutoff) map.delete(k);
      }
    };
    pruneMap(bucket.participants);
    pruneMap(bucket.endpoints);
    pruneMap(bucket.topics);

    // 重建 IP 集合（依据仍在窗口内的参与者/端点）
    const ips = new Set();
    for (const p of bucket.participants.values()) if (p.ip) ips.add(p.ip);
    for (const e of bucket.endpoints.values()) if (e.ip) ips.add(e.ip);
    bucket.ips = ips;
  }

  reset() {
    this.buckets.clear();
    this._compatCache.clear();
    this._revision++;
  }

  get revision() {
    return this._revision;
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------
  _summary(bucket) {
    const now = Date.now();
    const participantCount = bucket.participants.size;
    const topicCount = bucket.topics.size;
    let writerCount = 0;
    let readerCount = 0;
    const pubTopics = new Set();
    const subTopics = new Set();
    const endpointList = [];
    for (const e of bucket.endpoints.values()) {
      endpointList.push(e);
      if (e.role === 'writer') { writerCount++; if (e.topic) pubTopics.add(e.topic); }
      else if (e.role === 'reader') { readerCount++; if (e.topic) subTopics.add(e.topic); }
    }
    const ips = Array.from(bucket.ips);
    const recordRate = bucket.recentTs.filter((t) => now - t < 60000).length;

    // 兼容性结论：主题级 verdict 聚合
    let incompatibleTopics = 0;
    const statuses = [];
    for (const p of bucket.participants.values()) statuses.push(p.status);
    for (const e of bucket.endpoints.values()) statuses.push(e.status);

    let hasError = false;
    let hasWarn = false;
    for (const s of statuses) {
      if (s === 'ERROR') hasError = true;
      else if (s === 'WARN') hasWarn = true;
    }

    // 主题级兼容性结论（仅用于计算不兼容主题数）
    const topicCompat = new Map();
    for (const tk of bucket.topics.keys()) {
      const verdict = this._topicVerdict(bucket, tk);
      topicCompat.set(tk, verdict);
      if (verdict === 'INCOMPATIBLE' || verdict === 'PARTIAL') incompatibleTopics++;
    }
    if (incompatibleTopics > 0) hasWarn = true;

    const status = hasError ? 'ERROR' : (hasWarn ? 'WARN' : 'OK');
    const ipsSorted = ips.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const info = this._computeDomainInfo(bucket);
    return {
      domainId: bucket.domainId,
      participantCount,
      ips: ipsSorted,
      ipCount: ips.length,
      topicCount,
      writerCount,
      readerCount,
      status,
      incompatibleTopics,
      lastUpdate: bucket.lastUpdate,
      recordRate,
      portRange: info.portRange,
      multicastAddress: info.multicastAddress,
      nodeCount: info.nodeCount,
      nodeOnlineCount: info.nodeOnlineCount,
      nodeOfflineCount: info.nodeOfflineCount,
      participantOnlineCount: info.participantOnlineCount,
      participantOfflineCount: info.participantOfflineCount,
      vendorCounts: info.vendorCounts,
      publishTopicCount: pubTopics.size,
      subscribeTopicCount: subTopics.size,
    };
  }

  // 域级元信息（从 participant 的 locator / 在线信息推导）
  _computeDomainInfo(bucket) {
    const ports = new Set();
    let multicastAddress = null;
    const vendorCounts = new Map();
    const nodeOnline = new Map(); // ip -> 是否有在线参与者
    let participantOnline = 0;
    let participantOffline = 0;

    for (const p of bucket.participants.values()) {
      if (p.online) participantOnline++; else participantOffline++;
      const vname = p.vendorName || p.vendor;
      if (vname) vendorCounts.set(vname, (vendorCounts.get(vname) || 0) + 1);
      if (p.ip) {
        const cur = nodeOnline.get(p.ip);
        if (cur === undefined) nodeOnline.set(p.ip, !!p.online);
        else if (p.online) nodeOnline.set(p.ip, true);
      }
      const loc = p.locators || {};
      for (const key of ['metatrafficUnicast', 'metatrafficMulticast', 'defaultUnicast', 'defaultMulticast']) {
        for (const l of loc[key] || []) {
          if (l.port != null && l.port !== '' && !Number.isNaN(Number(l.port))) ports.add(Number(l.port));
        }
      }
      const mm = loc.metatrafficMulticast || [];
      if (!multicastAddress && mm[0] && mm[0].address) multicastAddress = String(mm[0].address);
    }

    const portList = Array.from(ports).sort((a, b) => a - b);
    const portRange = portList.length
      ? (portList.length === 1 ? String(portList[0]) : `${portList[0]}-${portList[portList.length - 1]}`)
      : null;

    let nodeOnlineCount = 0;
    let nodeOfflineCount = 0;
    for (const v of nodeOnline.values()) { if (v) nodeOnlineCount++; else nodeOfflineCount++; }

    return {
      portRange,
      multicastAddress,
      vendorCounts: Object.fromEntries(Array.from(vendorCounts.entries()).sort((a, b) => b[1] - a[1])),
      nodeCount: nodeOnline.size,
      nodeOnlineCount,
      nodeOfflineCount,
      participantOnlineCount: participantOnline,
      participantOfflineCount: participantOffline,
    };
  }

  // 主题级 verdict（带缓存，按 topicRev 失效）
  _topicVerdict(bucket, tk) {
    const parts = tk.split('|');
    const name = parts[0];
    const type = parts.length > 1 ? parts[1] : '';
    const rev = bucket.topicRev.get(tk) || 0;
    const cacheKey = `${bucket.domainId}|${tk}|${rev}`;
    if (this._compatCache.has(cacheKey)) return this._compatCache.get(cacheKey).verdict;
    const { writers, readers } = this._topicEndpoints(bucket, name);
    const result = evaluateCompatibility({
      domainId: bucket.domainId,
      topic: name,
      topicType: type,
      writers,
      readers,
      maxPairs: this._cfg().maxPairsPerTopic,
    });
    this._compatCache.set(cacheKey, result);
    return result.verdict;
  }

  _topicEndpoints(bucket, name) {
    const writers = [];
    const readers = [];
    for (const e of bucket.endpoints.values()) {
      if (e.topic !== name) continue;
      if (e.role === 'writer') writers.push(e);
      else if (e.role === 'reader') readers.push(e);
    }
    return { writers, readers };
  }

  // L0：域列表
  listDomains(opts = {}) {
    const q = opts.q ? String(opts.q).toLowerCase() : null;
    const status = opts.status || null;
    const domains = [];
    for (const bucket of this.buckets.values()) {
      const s = this._summary(bucket);
      if (status && s.status !== status) continue;
      if (q && !String(bucket.domainId).includes(q) && !s.ips.some((ip) => ip.includes(q))) continue;
      domains.push(s);
    }
    const sort = opts.sort || 'domainId';
    domains.sort((a, b) => {
      switch (sort) {
        case 'participantCount': return b.participantCount - a.participantCount;
        case 'topicCount': return b.topicCount - a.topicCount;
        case 'lastUpdate': return (b.lastUpdate || '').localeCompare(a.lastUpdate || '');
        case 'status': return a.status.localeCompare(b.status);
        default: {
          const an = Number(a.domainId), bn = Number(b.domainId);
          if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
          return String(a.domainId).localeCompare(String(b.domainId));
        }
      }
    });
    return { total: domains.length, domains };
  }

  // L1：域详情（参与者 + 主题两个视图的数据）
  getDomain(domainId, opts = {}) {
    const bucket = this.buckets.get(String(domainId));
    if (!bucket) return null;
    const summary = this._summary(bucket);

    const ipFilter = opts.ip ? String(opts.ip) : null;
    const nameFilter = opts.name ? String(opts.name) : null;
    const statusFilter = opts.status || null;

    const participants = [];
    for (const p of bucket.participants.values()) {
      if (ipFilter && !(p.ip && p.ip.startsWith(ipFilter))) continue;
      if (statusFilter && p.status !== statusFilter) continue;
      const pub = this._participantTopics(bucket, p, 'writer');
      const sub = this._participantTopics(bucket, p, 'reader');
      participants.push({
        guid: p.guid, name: p.name, ip: p.ip, host: p.host, pid: p.pid,
        status: p.status, statusRaw: p.statusRaw, qos: p.qos,
        vendor: p.vendor, vendorName: p.vendorName, vendorValue: p.vendorValue,
        rtpsVersion: p.rtpsVersion,
        online: p.online, onlineTimestamp: p.onlineTimestamp, downlineTimestamp: p.downlineTimestamp,
        publishedTopicCount: pub.size, subscribedTopicCount: sub.size,
        lastSeen: new Date(p.lastSeenMs).toISOString(),
      });
    }
    participants.sort((a, b) => (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true }));

    const topics = [];
    for (const t of bucket.topics.values()) {
      if (nameFilter && !t.name.includes(nameFilter)) continue;
      const { writers, readers } = this._topicEndpoints(bucket, t.name);
      topics.push({
        name: t.name, type: t.type, partition: t.partition, qos: t.qos,
        writerCount: writers.length, readerCount: readers.length,
        compatVerdict: this._topicVerdict(bucket, t.key),
        lastSeen: new Date(t.lastSeenMs).toISOString(),
      });
    }
    topics.sort((a, b) => a.name.localeCompare(b.name));

    const vendors = (summary.vendorCounts ? Object.entries(summary.vendorCounts) : [])
      .map(([name, count]) => ({ name, count }));

    return { summary, participants, topics, vendors, revision: this._revision };
  }

  _participantTopics(bucket, participant, role) {
    const set = new Set();
    for (const e of bucket.endpoints.values()) {
      if (e.role !== role) continue;
      const matchGuid = participant.guid && e.participantGuid && e.participantGuid === participant.guid;
      const matchIp = participant.ip && e.ip === participant.ip;
      if (matchGuid || matchIp) set.add(e.topic);
    }
    return set;
  }

  _participantEndpoints(bucket, participant) {
    const out = [];
    for (const e of bucket.endpoints.values()) {
      const matchGuid = participant.guid && e.participantGuid && e.participantGuid === participant.guid;
      const matchIp = participant.ip && e.ip === participant.ip;
      if (matchGuid || matchIp) out.push(e);
    }
    return out;
  }

  // FR-05-10：按 IP 过滤参与者
  getParticipants(domainId, ip) {
    const bucket = this.buckets.get(String(domainId));
    if (!bucket) return { total: 0, participants: [] };
    const filter = ip ? String(ip) : null;
    const out = [];
    for (const p of bucket.participants.values()) {
      if (filter && !(p.ip && p.ip.startsWith(filter))) continue;
      out.push({ guid: p.guid, name: p.name, ip: p.ip, host: p.host, pid: p.pid, status: p.status, statusRaw: p.statusRaw, qos: p.qos, lastSeen: new Date(p.lastSeenMs).toISOString() });
    }
    out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return { total: out.length, participants: out };
  }

  // L2-B：参与者详情
  getParticipant(guid, domainId) {
    let bucket = null;
    let participant = null;
    if (domainId != null) {
      bucket = this.buckets.get(String(domainId));
      if (bucket) participant = bucket.participants.get(String(guid));
      if (participant == null && bucket) {
        // 兼容：guid 可能是组合键，遍历匹配
        for (const p of bucket.participants.values()) {
          if (p.guid === guid || p.dedupKey === guid) { participant = p; break; }
        }
      }
    } else {
      for (const b of this.buckets.values()) {
        for (const p of b.participants.values()) {
          if (p.guid === guid || p.dedupKey === guid) { bucket = b; participant = p; break; }
        }
        if (participant) break;
      }
    }
    if (!participant) return null;
    const endpoints = this._participantEndpoints(bucket, participant);
    const published = [];
    const subscribed = [];
    for (const e of endpoints) {
      const entry = { name: e.topic, type: e.type, guid: e.guid, ip: e.ip, qos: e.qos, status: e.status, sampleRate: e.sampleRate };
      if (e.role === 'writer') published.push(entry);
      else if (e.role === 'reader') subscribed.push(entry);
    }
    return {
      guid: participant.guid, name: participant.name, ip: participant.ip, host: participant.host,
      pid: participant.pid, status: participant.status, statusRaw: participant.statusRaw, qos: participant.qos,
      vendor: participant.vendor, vendorName: participant.vendorName, vendorValue: participant.vendorValue,
      rtpsVersion: participant.rtpsVersion,
      online: participant.online, onlineTimestamp: participant.onlineTimestamp, downlineTimestamp: participant.downlineTimestamp,
      locators: participant.locators,
      publishedTopics: published,
      subscribedTopics: subscribed,
      endpoints: endpoints.map((e) => ({ guid: e.guid, role: e.role, topic: e.topic, type: e.type, ip: e.ip, participantGuid: e.participantGuid, entityName: e.entityName, idlfile: e.idlfile, qos: e.qos, status: e.status, sampleRate: e.sampleRate })),
      domainId: bucket.domainId,
      lastSeen: new Date(participant.lastSeenMs).toISOString(),
    };
  }

  // FR-05-10：按主题名过滤
  getTopics(domainId, name) {
    const bucket = this.buckets.get(String(domainId));
    if (!bucket) return { total: 0, topics: [] };
    const filter = name ? String(name) : null;
    const out = [];
    for (const t of bucket.topics.values()) {
      if (filter && !t.name.includes(filter)) continue;
      const { writers, readers } = this._topicEndpoints(bucket, t.name);
      out.push({ name: t.name, type: t.type, partition: t.partition, qos: t.qos, writerCount: writers.length, readerCount: readers.length, compatVerdict: this._topicVerdict(bucket, t.key), lastSeen: new Date(t.lastSeenMs).toISOString() });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { total: out.length, topics: out };
  }

  // L2-C：主题详情（全部发送/接收 IP + 兼容性）
  getTopic(domainId, topicName) {
    const bucket = this.buckets.get(String(domainId));
    if (!bucket) return null;
    const name = String(topicName);
    const { writers, readers } = this._topicEndpoints(bucket, name);
    const topics = Array.from(bucket.topics.values()).filter((t) => t.name === name);
    const type = topics.length === 1 ? topics[0].type : (topics.length > 1 ? topics.map((t) => t.type).filter(Boolean) : null);
    const partition = topics.length ? topics[0].partition : undefined;
    const qos = topics.length ? topics[0].qos : {};

    const participantName = (participantGuid, ip) => {
      for (const p of bucket.participants.values()) {
        if (participantGuid && p.guid === participantGuid) return p.name;
      }
      return null;
    };

    const fmtEp = (e) => ({
      ip: e.ip, guid: e.guid, participantGuid: e.participantGuid,
      participantName: participantName(e.participantGuid, e.ip),
      type: e.type, entityName: e.entityName, idlfile: e.idlfile,
      qos: e.qos, status: e.status, sampleRate: e.sampleRate,
    });

    const writersOut = writers.map(fmtEp);
    const readersOut = readers.map(fmtEp);
    const sendIps = Array.from(new Set(writersOut.map((w) => w.ip).filter(Boolean))).sort();
    const receiveIps = Array.from(new Set(readersOut.map((r) => r.ip).filter(Boolean))).sort();
    const unknownIpEndpointCount = writersOut.concat(readersOut).filter((e) => !e.ip).length;

    const result = evaluateCompatibility({
      domainId: bucket.domainId,
      topic: name,
      topicType: typeof type === 'string' ? type : undefined,
      writers,
      readers,
      maxPairs: this._cfg().maxPairsPerTopic,
    });
    if (result.results) {
      for (const r of result.results) r.evaluatedAt = new Date().toISOString();
    }

    return {
      name,
      type,
      partition,
      qos,
      writers: writersOut,
      readers: readersOut,
      sendIps,
      receiveIps,
      compatibility: result,
      unknownIpEndpointCount,
      multiType: Array.isArray(type) && type.length > 1,
    };
  }

  // -------------------------------------------------------------------------
  // 需求 4：节点（IP）间收发关系 + 需求 5：主题↔IP 对应。
  // 发送/接收严格依据 endpoint 的 role（来自 endpoint_type 的 datawriter/datareader），
  // 不使用 pubsub_guid 判断方向。
  // -------------------------------------------------------------------------

  // 单 IP 详情：该 IP 的发送主题（有 datawriter）与接收主题（有 datareader）。
  getIpDetail(domainId, ip) {
    const bucket = this.buckets.get(String(domainId));
    if (!bucket) return null;
    const target = String(ip);
    const sendTopics = new Map();   // topic -> { name, type, count }
    const receiveTopics = new Map();
    for (const e of bucket.endpoints.values()) {
      if (e.ip !== target || !e.topic) continue;
      if (e.role === 'writer') {
        const cur = sendTopics.get(e.topic) || { name: e.topic, type: e.type, count: 0 };
        cur.count += 1; if (cur.type == null && e.type != null) cur.type = e.type;
        sendTopics.set(e.topic, cur);
      } else if (e.role === 'reader') {
        const cur = receiveTopics.get(e.topic) || { name: e.topic, type: e.type, count: 0 };
        cur.count += 1; if (cur.type == null && e.type != null) cur.type = e.type;
        receiveTopics.set(e.topic, cur);
      }
    }
    const sortTopics = (m) => Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
    return {
      ip: target,
      sendTopics: sortTopics(sendTopics),
      receiveTopics: sortTopics(receiveTopics),
      sendTopicCount: sendTopics.size,
      receiveTopicCount: receiveTopics.size,
    };
  }

  // 单 IP 交互节点：该 IP 发送给哪些 IP（按主题）、从哪些 IP 接收（按主题）。
  getIpInteractions(domainId, ip) {
    const bucket = this.buckets.get(String(domainId));
    if (!bucket) return null;
    const target = String(ip);
    const topicMap = new Map(); // topic -> { writers:Set, readers:Set }
    for (const e of bucket.endpoints.values()) {
      if (!e.topic || !e.ip) continue;
      let t = topicMap.get(e.topic);
      if (!t) { t = { topic: e.topic, writers: new Set(), readers: new Set() }; topicMap.set(e.topic, t); }
      if (e.role === 'writer') t.writers.add(e.ip);
      else if (e.role === 'reader') t.readers.add(e.ip);
    }
    const sendTo = new Map();     // peerIp -> Set<topic>
    const receiveFrom = new Map();
    for (const t of topicMap.values()) {
      if (t.writers.has(target)) {
        for (const r of t.readers) {
          if (r === target) continue;
          if (!sendTo.has(r)) sendTo.set(r, new Set());
          sendTo.get(r).add(t.topic);
        }
      }
      if (t.readers.has(target)) {
        for (const w of t.writers) {
          if (w === target) continue;
          if (!receiveFrom.has(w)) receiveFrom.set(w, new Set());
          receiveFrom.get(w).add(t.topic);
        }
      }
    }
    const fmt = (m) => Array.from(m.entries())
      .map(([peerIp, topics]) => ({ ip: peerIp, topics: Array.from(topics).sort() }))
      .sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    return { ip: target, sendTo: fmt(sendTo), receiveFrom: fmt(receiveFrom) };
  }

  // 需求 5：按 IP 查看 —— 每个 IP 的发送主题 / 接收主题清单。
  getIpTopics(domainId) {
    const bucket = this.buckets.get(String(domainId));
    if (!bucket) return { domainId: String(domainId), total: 0, ips: [] };
    const map = new Map(); // ip -> { sendTopics: Set, receiveTopics: Set }
    for (const e of bucket.endpoints.values()) {
      if (!e.ip || !e.topic) continue;
      let m = map.get(e.ip);
      if (!m) { m = { ip: e.ip, sendTopics: new Set(), receiveTopics: new Set() }; map.set(e.ip, m); }
      if (e.role === 'writer') m.sendTopics.add(e.topic);
      else if (e.role === 'reader') m.receiveTopics.add(e.topic);
    }
    const ips = Array.from(map.values()).map((m) => ({
      ip: m.ip,
      sendTopics: Array.from(m.sendTopics).sort(),
      receiveTopics: Array.from(m.receiveTopics).sort(),
    })).sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    return { domainId: String(domainId), total: ips.length, ips };
  }

  // 需求 4：按主题的节点（IP）收发关系，含自发自收（同一 IP 既发送又接收）。
  getNodeRelations(domainId) {
    const bucket = this.buckets.get(String(domainId));
    if (!bucket) return null;
    const topicMap = new Map(); // topic -> { topic, type, senders:Set, receivers:Set }
    for (const e of bucket.endpoints.values()) {
      if (!e.topic) continue;
      if (!e.ip) continue; // 无 IP 无法形成节点关系
      let t = topicMap.get(e.topic);
      if (!t) { t = { topic: e.topic, type: e.type, senders: new Set(), receivers: new Set() }; topicMap.set(e.topic, t); }
      if (e.type != null && t.type == null) t.type = e.type;
      if (e.role === 'writer') t.senders.add(e.ip);
      else if (e.role === 'reader') t.receivers.add(e.ip);
    }
    const relations = [];
    const edges = [];
    for (const t of topicMap.values()) {
      const senders = Array.from(t.senders).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const receivers = Array.from(t.receivers).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const selfSendRecv = senders.some((ip) => t.receivers.has(ip));
      relations.push({ topic: t.topic, type: t.type, senders, receivers, selfSendRecv });
      for (const s of senders) {
        for (const r of receivers) {
          edges.push({ topic: t.topic, from: s, to: r, self: s === r });
        }
      }
    }
    relations.sort((a, b) => a.topic.localeCompare(b.topic));
    const nodes = Array.from(bucket.ips).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return { domainId: String(domainId), nodes, relations, edges };
  }

  // FR-05-12：可用 IP 清单
  listIps(domainId, q) {
    const ips = new Set();
    if (domainId != null) {
      const bucket = this.buckets.get(String(domainId));
      if (bucket) for (const ip of bucket.ips) ips.add(ip);
    } else {
      for (const bucket of this.buckets.values()) for (const ip of bucket.ips) ips.add(ip);
    }
    const filter = q ? String(q).toLowerCase() : null;
    return { ips: Array.from(ips).filter((ip) => !filter || ip.toLowerCase().includes(filter)).sort() };
  }
}

module.exports = { Aggregator, aggregateVerdict };
