'use strict';

const express = require('express');
const os = require('os');
const path = require('path');
const { INCOMPLETE_XML, FILE_TOO_LARGE } = require('./parser');

// Topic 名常含 `/`（如 rt/vehicle/pose），URL 编码后由 Express 解码；此处做一次防御性解码。
function decodeSegment(v) {
  try {
    const d = decodeURIComponent(v);
    return d;
  } catch (_) {
    return v;
  }
}

function createRouter(deps) {
  const { store, configManager, watcher, sseHub, demo, logger, version, aggregator, aliases, monitor } = deps;
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

  // 单文件导入：原始字节体 + X-File-Name 头（浏览器上传文件选择器）
  router.post('/api/import', express.raw({
    type: ['application/xml', 'text/xml', 'application/octet-stream'],
    limit: (configManager.get().maxFileSize || 10485760) + 1024 * 1024,
  }), (req, res) => {
    const buf = req.body;
    if (!buf || !buf.length) return fail(res, 400, 'EMPTY_FILE', '未收到文件内容');
    try {
      const r = watcher.importBuffer(buf, req.headers['x-file-name']);
      res.json(ok(r));
    } catch (err) {
      if (err && err.code === INCOMPLETE_XML) return fail(res, 400, INCOMPLETE_XML, err.message);
      if (err && err.code === FILE_TOO_LARGE) return fail(res, 413, FILE_TOO_LARGE, err.message);
      return fail(res, 400, 'PARSE_ERROR', (err && err.message) || '解析失败');
    }
  });

  // 清空内存缓冲
  router.post('/api/clear', (req, res) => {
    const r = store.clear();
    if (aggregator) aggregator.reset();
    res.json(ok(r));
  });

  // ---- v1.1：域 / 参与者 / 主题 / 兼容性接口（FR-05-9~12） ----

  // 域级列表（L0）
  router.get('/api/domains', (req, res) => {
    const r = aggregator.listDomains({ q: req.query.q, sort: req.query.sort, status: req.query.status });
    res.json(ok(r));
  });

  // 域详情（L1）
  router.get('/api/domains/:domainId', (req, res) => {
    const detail = aggregator.getDomain(decodeSegment(req.params.domainId), {
      ip: req.query.ip,
      name: req.query.name,
      status: req.query.status,
    });
    if (!detail) return fail(res, 404, 'DOMAIN_NOT_FOUND', `域 ${req.params.domainId} 在统计窗口内没有数据`);
    res.json(ok(detail));
  });

  // 按 IP 过滤参与者
  router.get('/api/domains/:domainId/participants', (req, res) => {
    const r = aggregator.getParticipants(decodeSegment(req.params.domainId), req.query.ip);
    res.json(ok(r));
  });

  // 按主题名过滤主题
  router.get('/api/domains/:domainId/topics', (req, res) => {
    const r = aggregator.getTopics(decodeSegment(req.params.domainId), req.query.name);
    res.json(ok(r));
  });

  // 主题详情（L2-C）：全部发送/接收 IP + 兼容性
  router.get('/api/domains/:domainId/topics/:topicName/compatibility', (req, res) => {
    const detail = aggregator.getTopic(decodeSegment(req.params.domainId), decodeSegment(req.params.topicName));
    if (!detail) return fail(res, 404, 'TOPIC_NOT_FOUND', `主题 ${req.params.topicName} 在统计窗口内没有数据`);
    res.json(ok({ domainId: req.params.domainId, topic: detail.name, verdict: detail.compatibility.verdict, results: detail.compatibility.results, truncated: detail.compatibility.truncated }));
  });

  router.get('/api/domains/:domainId/topics/:topicName', (req, res) => {
    const detail = aggregator.getTopic(decodeSegment(req.params.domainId), decodeSegment(req.params.topicName));
    if (!detail) return fail(res, 404, 'TOPIC_NOT_FOUND', `主题 ${req.params.topicName} 在统计窗口内没有数据`);
    res.json(ok(detail));
  });

  // 参与者详情（L2-B）
  router.get('/api/participants/:guid', (req, res) => {
    const detail = aggregator.getParticipant(decodeSegment(req.params.guid), req.query.domainId != null ? decodeSegment(req.query.domainId) : null);
    if (!detail) return fail(res, 404, 'PARTICIPANT_NOT_FOUND', `参与者 ${req.params.guid} 在统计窗口内没有数据`);
    res.json(ok(detail));
  });

  // 可用 IP 清单（过滤下拉自动补全）
  router.get('/api/ips', (req, res) => {
    const r = aggregator.listIps(req.query.domainId != null ? decodeSegment(req.query.domainId) : null, req.query.q);
    res.json(ok(r));
  });

  // ---- 需求 4/5：节点收发关系 + 主题↔IP 对应 ----

  // 节点（IP）间收发关系（含自发自收）
  router.get('/api/domains/:domainId/relations', (req, res) => {
    const detail = aggregator.getNodeRelations(decodeSegment(req.params.domainId));
    if (!detail) return fail(res, 404, 'DOMAIN_NOT_FOUND', `域 ${req.params.domainId} 在统计窗口内没有数据`);
    res.json(ok(detail));
  });

  // 按 IP 查看：每个 IP 的发送/接收主题
  router.get('/api/domains/:domainId/ip-topics', (req, res) => {
    const r = aggregator.getIpTopics(decodeSegment(req.params.domainId));
    res.json(ok(r));
  });

  // 单 IP 详情：发送主题 / 接收主题
  router.get('/api/domains/:domainId/ips/:ip', (req, res) => {
    const detail = aggregator.getIpDetail(decodeSegment(req.params.domainId), decodeSegment(req.params.ip));
    if (!detail) return fail(res, 404, 'IP_NOT_FOUND', `IP ${req.params.ip} 在域 ${req.params.domainId} 内没有端点数据`);
    res.json(ok(detail));
  });

  // 单 IP 交互节点：发给谁 / 收自谁（按主题归类）
  router.get('/api/domains/:domainId/ips/:ip/interactions', (req, res) => {
    const detail = aggregator.getIpInteractions(decodeSegment(req.params.domainId), decodeSegment(req.params.ip));
    if (!detail) return fail(res, 404, 'IP_NOT_FOUND', `IP ${req.params.ip} 在域 ${req.params.domainId} 内没有端点数据`);
    res.json(ok(detail));
  });

  // ---- IP 节点别名（需求 3） ----
  router.get('/api/aliases', (req, res) => {
    res.json(ok({ aliases: aliases.getAll() }));
  });

  router.put('/api/aliases', (req, res) => {
    const body = req.body || {};
    const r = aliases.set(body.ip, body.alias);
    if (!r.ok) return fail(res, 400, r.code, r.message);
    res.json(ok({ aliases: r.aliases }));
  });

  router.delete('/api/aliases/:ip', (req, res) => {
    const r = aliases.remove(decodeSegment(req.params.ip));
    res.json(ok({ aliases: r.aliases }));
  });

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

  // ---- 监控端对接（解析端 ↔ ljdds_monitor_service） ----

  // 状态 + 当前配置 + 校验结果
  router.get('/api/monitor', (req, res) => {
    res.json(ok(monitor.status()));
  });

  // 输出目录 XML 清单
  router.get('/api/monitor/files', (req, res) => {
    res.json(ok(monitor.listFiles()));
  });

  // 写入 3 个配置文件（project_name/start_time 必填、至少一个域）
  router.put('/api/monitor/config', (req, res) => {
    const r = monitor.writeConfig(req.body);
    if (!r.ok) return fail(res, 400, r.code, r.message);
    res.json(ok(r));
  });

  // 校验并启动监控端
  router.post('/api/monitor/start', (req, res) => {
    const r = monitor.start();
    if (!r.ok) return fail(res, 400, r.code, r.message);
    res.json(ok(r));
  });

  // 停止监控端
  router.post('/api/monitor/stop', (req, res) => {
    const r = monitor.stop();
    if (!r.ok) return fail(res, 400, r.code, r.message);
    res.json(ok(r));
  });

  // 保存当前 XML（可选 body.dest 指定目标路径；缺省保存到解析端 saveBase/$project_name/$start_time）
  router.post('/api/monitor/save', (req, res) => {
    const r = monitor.saveCurrent(req.body && req.body.dest);
    if (!r.ok) return fail(res, 400, r.code, r.message);
    res.json(ok(r));
  });

  return router;
}

module.exports = { createRouter };
