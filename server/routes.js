'use strict';

const express = require('express');
const os = require('os');
const path = require('path');

function createRouter(deps) {
  const { store, configManager, watcher, sseHub, demo, logger, version } = deps;
  const router = express.Router();

  const ok = (data) => ({ ok: true, ...data });
  const fail = (res, status, code, message) =>
    res.status(status).json({ ok: false, error: { code, message } });

  // 健康检查
  router.get('/api/health', (req, res) => {
    res.json(ok({
      version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSec: Math.round(process.uptime()),
      sseClients: sseHub.count(),
    }));
  });

  // 记录查询
  router.get('/api/records', (req, res) => {
    const r = store.query({
      limit: req.query.limit,
      node: req.query.node,
      topic: req.query.topic,
      status: req.query.status,
      q: req.query.q,
      since: req.query.since,
    });
    res.json(ok(r));
  });

  // 统计
  router.get('/api/stats', (req, res) => res.json(ok(store.getStats())));

  // 可用数值指标名
  router.get('/api/metrics', (req, res) => res.json(ok(store.getMetricNames())));

  // 指标时间序列
  router.get('/api/series', (req, res) => {
    const metric = req.query.metric;
    if (!metric) return fail(res, 400, 'INVALID_CONFIG', '缺少 metric 参数');
    res.json(ok(store.getSeries(metric, req.query.limit)));
  });

  // 当前配置 + 监听状态
  router.get('/api/config', (req, res) => {
    res.json(ok({ config: configManager.public(), watcher: watcher.getStatus() }));
  });

  // 热更新配置
  router.put('/api/config', (req, res) => {
    const result = configManager.update(req.body);
    if (!result.ok) return fail(res, 400, result.code, result.message);
    res.json(ok({ config: result.config, watcher: watcher.getStatus() }));
  });

  // 最近解析告警
  router.get('/api/errors', (req, res) => res.json(ok(store.getErrors(req.query.limit))));

  // 手动全量重扫
  router.post('/api/scan', async (req, res) => {
    const r = await watcher.rescan();
    res.json(ok(r));
  });

  // 清空内存缓冲
  router.post('/api/clear', (req, res) => res.json(ok(store.clear())));

  // 演示数据：原子写
  router.post('/api/demo/emit', (req, res) => {
    const count = Math.min(Math.max(Number(req.query.count) || 1, 1), 20);
    const files = demo.emitAtomic(count);
    res.json(ok({ files }));
  });

  // 演示数据：慢速分块写（验证防半截）
  router.post('/api/demo/slow', (req, res) => {
    const chunks = Math.min(Math.max(Number(req.query.chunks) || 20, 2), 200);
    const intervalMs = Math.min(Math.max(Number(req.query.intervalMs) || 50, 10), 1000);
    const file = demo.emitSlow(chunks, intervalMs);
    res.json(ok({ file }));
  });

  return router;
}

module.exports = { createRouter };
