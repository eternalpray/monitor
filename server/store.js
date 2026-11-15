'use strict';

const { EventEmitter } = require('events');

// 内存环形缓冲 + 幂等去重 + 统计聚合。不落盘、无数据库。
class Store extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.records = [];            // 新记录在前（unshift）
    this._seenIds = new Set();
    this.errors = [];             // 解析/监听告警
    this.stats = this._emptyStats();
    this.fileCount = 0;
    this._files = new Set();
  }

  _emptyStats() {
    return {
      totalIngested: 0,
      bufferedRecords: 0,
      fileCount: 0,
      parseSuccess: 0,
      parseFail: 0,
      nodeDistribution: {},
      topicDistribution: {},
      statusDistribution: { OK: 0, WARN: 0, ERROR: 0, UNKNOWN: 0 },
      domainDistribution: {},
      kindDistribution: {},
      rate1m: 0,
      lastUpdate: null,
    };
  }

  // 返回 false 表示幂等去重命中（未新增）
  add(record) {
    if (this._seenIds.has(record.id)) return false;
    this._seenIds.add(record.id);
    // 防 Set 无限增长：超量后整体清空（缓冲本身有界，幂等主要针对近期事件）
    if (this._seenIds.size > 200000) this._seenIds.clear();

    this.records.unshift(record);
    const max = this.config.bufferSize;
    if (this.records.length > max) {
      const removed = this.records.splice(max);
      for (const r of removed) {
        // 旧记录裁剪详情字段，控制内存
        delete r.raw;
        delete r.rawXml;
      }
    }
    // 详情仅保留最近 detailRetainCount 条
    const keep = this.config.detailRetainCount || 500;
    if (this.records.length > keep) {
      const old = this.records[keep];
      if (old && old.raw) { delete old.raw; delete old.rawXml; }
    }

    if (!this._files.has(record.filePath)) {
      this._files.add(record.filePath);
      this.fileCount = this._files.size;
    }

    this.stats.totalIngested += 1;
    this.stats.parseSuccess += 1;
    this.stats.bufferedRecords = this.records.length;
    this.stats.fileCount = this.fileCount;
    this.stats.nodeDistribution[record.node] = (this.stats.nodeDistribution[record.node] || 0) + 1;
    this.stats.statusDistribution[record.status] = (this.stats.statusDistribution[record.status] || 0) + 1;
    this.stats.domainDistribution[record.domain] = (this.stats.domainDistribution[record.domain] || 0) + 1;
    this.stats.kindDistribution[record.kind] = (this.stats.kindDistribution[record.kind] || 0) + 1;
    for (const t of record.topics || []) {
      this.stats.topicDistribution[t.name] = (this.stats.topicDistribution[t.name] || 0) + 1;
    }
    this.stats.lastUpdate = new Date().toISOString();
    this._recalcRate();

    this.emit('record', record);
    return true;
  }

  addError(errInfo) {
    const e = {
      at: new Date().toISOString(),
      level: errInfo.level || 'error',
      message: errInfo.message || 'unknown',
      file: errInfo.file || null,
      code: errInfo.code || null,
    };
    this.errors.unshift(e);
    if (this.errors.length > 200) this.errors.length = 200;
    this.stats.parseFail += 1;
    this.emit('alert', e);
    return e;
  }

  _recalcRate() {
    const now = Date.now();
    const cutoff = now - 60000;
    let count = 0;
    for (const r of this.records) {
      const t = new Date(r.receivedAt).getTime();
      if (t >= cutoff) count++;
      else break; // 记录按时间倒序，越往后越旧
    }
    this.stats.rate1m = count;
  }

  // 查询：limit/node/topic/status/q/since
  query(opts = {}) {
    const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 2000);
    const node = opts.node;
    const topic = opts.topic;
    const status = opts.status;
    const q = opts.q ? String(opts.q).toLowerCase() : null;
    const since = opts.since ? new Date(opts.since).getTime() : null;

    const out = [];
    for (const r of this.records) {
      if (out.length >= limit) break;
      if (node && r.node !== node) continue;
      if (status && r.status !== status) continue;
      if (topic && !(r.topics || []).some((t) => t.name === topic)) continue;
      if (since && new Date(r.receivedAt).getTime() < since) continue;
      if (q) {
        const hay = `${r.node} ${r.domain} ${r.status} ${r.kind} ${r.typeName || ''} ${(r.topics || []).map((t) => t.name).join(' ')} ${r.fileName}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push(r);
    }
    return { total: this.records.length, records: out };
  }

  recent(n = 200) {
    return this.records.slice(0, n);
  }

  getStats() {
    this._recalcRate();
    const s = this.stats;
    return {
      totalIngested: s.totalIngested,
      bufferedRecords: this.records.length,
      fileCount: this.fileCount,
      parseSuccess: s.parseSuccess,
      parseFail: s.parseFail,
      nodeCount: Object.keys(s.nodeDistribution).length,
      topicCount: Object.keys(s.topicDistribution).length,
      nodeDistribution: s.nodeDistribution,
      topicDistribution: s.topicDistribution,
      statusDistribution: s.statusDistribution,
      domainDistribution: s.domainDistribution,
      kindDistribution: s.kindDistribution,
      rate1m: s.rate1m,
      lastUpdate: s.lastUpdate,
    };
  }

  getMetricNames() {
    const names = new Set();
    for (const r of this.records) {
      for (const k of Object.keys(r.numericMetrics || {})) {
        names.add(k);
        if (names.size >= 200) break;
      }
      if (names.size >= 200) break;
    }
    return { metrics: Array.from(names) };
  }

  getSeries(metric, limit = 200) {
    const points = [];
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    for (const r of this.records) {
      if (points.length >= lim) break;
      const v = r.numericMetrics && r.numericMetrics[metric];
      if (v === undefined) continue;
      points.push({ t: r.receivedAt, v });
    }
    points.reverse(); // 时间升序
    return { metric, points };
  }

  getErrors(limit = 100) {
    return { errors: this.errors.slice(0, Math.min(Number(limit) || 100, 500)) };
  }

  clear() {
    this.records = [];
    this.stats = this._emptyStats();
    this.stats.fileCount = this.fileCount;
    this.errors = [];
    this._seenIds.clear();
    return { ok: true };
  }

  resetFileCount() {
    this._files.clear();
    this.fileCount = 0;
    this.stats.fileCount = 0;
  }
}

module.exports = { Store };
