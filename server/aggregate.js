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
    const endpointList = [];
    for (const e of bucket.endpoints.values()) {
      endpointList.push(e);
      if (e.role === 'writer') writerCount++;
      else if (e.role === 'reader') readerCount++;
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
        publishedTopicCount: pub.size, subscribedTopicCount: sub.size,
        lastSeen: new Date(p.lastSeenMs).toISOString(),
      });
    }
    participants.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

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

    return { summary, participants, topics, revision: this._revision };
  }

  _participantTopics(bucket, participant, role) {
    const set = new Set();
    for (const e of bucket.endpoints.values()) {
      if (e.role !== role) continue;
      const matchGuid = participant.guid && e.participantGuid && e.participantGuid === participant.guid;
      const matchIp = !e.participantGuid && participant.ip && e.ip === participant.ip;
      if (matchGuid || matchIp) set.add(e.topic);
    }
    return set;
  }

  _participantEndpoints(bucket, participant) {
    const out = [];
    for (const e of bucket.endpoints.values()) {
      const matchGuid = participant.guid && e.participantGuid && e.participantGuid === participant.guid;
      const matchIp = !e.participantGuid && participant.ip && e.ip === participant.ip;
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
      publishedTopics: published,
      subscribedTopics: subscribed,
      endpoints: endpoints.map((e) => ({ guid: e.guid, role: e.role, topic: e.topic, type: e.type, ip: e.ip, participantGuid: e.participantGuid, qos: e.qos, status: e.status, sampleRate: e.sampleRate })),
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
