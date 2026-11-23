'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const logger = require('./logger');
const { ConfigManager } = require('./config');
const { createParser } = require('./parser');
const { Store } = require('./store');
const { SseHub } = require('./sse');
const { Watcher } = require('./watcher');
const { Aggregator } = require('./aggregate');
const { AliasStore } = require('./aliases');
const { createRouter } = require('./routes');
const { createDemo } = require('./demo');
const { MonitorService } = require('./monitor');

const VERSION = '1.1.0';
const ROOT = path.resolve(__dirname, '..');

function main() {
  const configManager = new ConfigManager(ROOT, path.join(ROOT, 'config', 'config.json'));
  const config = configManager.get();

  if (process.env.LOG_LEVEL) logger.setLevel(process.env.LOG_LEVEL);

  const store = new Store(config);
  const parser = createParser(config);
  const sseHub = new SseHub();
  const watcher = new Watcher(configManager, parser, store);
  const aggregator = new Aggregator(configManager);
  const aliases = new AliasStore(configManager);
  const demo = createDemo(configManager);
  const monitor = new MonitorService(configManager, parser, store);

  configManager.attachWatcher(watcher);

  // --- 域相关 SSE 事件节流（FR-04-7，默认 200ms 合并） ---
  let pendingDomains = new Set();
  let flushTimer = null;
  function scheduleDomainBroadcast(domainId) {
    pendingDomains.add(domainId);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const changed = Array.from(pendingDomains);
      pendingDomains = new Set();
      sseHub.broadcast('domains', { domains: aggregator.listDomains().domains, revision: aggregator.revision });
      for (const d of changed) {
        const detail = aggregator.getDomain(d);
        if (detail) sseHub.broadcast('domainDetail', { domainId: d, ...detail });
      }
    }, config.domainEventThrottleMs);
  }

  // --- 事件接线：监听 → 存储 → 聚合 → SSE 广播 ---
  store.on('record', (record) => {
    aggregator.add(record);
    scheduleDomainBroadcast(record.domainId);
  });

  watcher.on('records', (payload) => {
    sseHub.broadcast('records', payload);
    sseHub.broadcast('stats', store.getStats());
  });
  watcher.on('alert', (a) => {
    store.addError(a);
    sseHub.broadcast('alert', a);
    sseHub.broadcast('stats', store.getStats());
  });
  watcher.on('watcher', (s) => sseHub.broadcast('watcher', s));

  // 监控端对接：输出 XML 导入 / 状态变化 → SSE；解析告警 → 告警通道
  monitor.on('monitor', (p) => {
    sseHub.broadcast('monitor', p);
    sseHub.broadcast('stats', store.getStats());
  });
  monitor.on('alert', (a) => {
    store.addError(a);
    sseHub.broadcast('alert', a);
    sseHub.broadcast('stats', store.getStats());
  });

  // --- Express ---
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  const router = createRouter({ store, configManager, watcher, sseHub, demo, logger, aggregator, aliases, monitor, version: VERSION });
  app.use(router);

  // SSE 长连接
  app.get('/api/events', (req, res) => {
    const clientId = sseHub.addClient(req, res);
    sseHub.send(clientId, 'hello', {
      clientId,
      serverTime: new Date().toISOString(),
      version: VERSION,
    });
    // 连接建立即推送快照，避免“先连上但页面空白”
    sseHub.send(clientId, 'snapshot', {
      records: store.recent(200),
      stats: store.getStats(),
      config: configManager.public(),
      watcher: watcher.getStatus(),
      domains: aggregator.listDomains().domains,
      monitor: monitor.status(),
    });
  });

  // 静态资源 + SPA 回退
  const publicDir = path.join(__dirname, 'public');
  const indexHtml = path.join(publicDir, 'index.html');
  app.use(express.static(publicDir, { index: false, maxAge: '1h' }));
  app.get('/', (req, res, next) => {
    if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml);
    next();
  });
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml);
    res.status(200).send(
      '<h2>DDS 轻量监控工具已启动</h2><p>前端尚未构建。请运行 <code>npm run build</code> 后刷新，' +
      '或直接使用 REST 接口（<code>/api/health</code>、<code>/api/records</code>）。</p>'
    );
  });

  // 统一 404（API 未匹配）
  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  // 全局错误处理
  app.use((err, req, res, next) => {
    logger.error('unhandled', { msg: err.message, stack: err.stack });
    res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: '服务内部错误' } });
  });

  // 冷启动种子：写入演示数据集（幂等，仅在缺失时写入），保证首次打开即有域可看
  try { demo.seedDataset(); } catch (err) { logger.warn('seed-demo', { msg: err.message }); }

  // 启动监听 + 服务器
  watcher.start();
  const port = config.port;
  const host = config.host;
  const server = app.listen(port, host, () => {
    logger.info('listening', { host, port, node: process.version, arch: process.arch, watchDir: watcher.getStatus().dir });
    console.log(`\n  DDS 轻量监控工具已启动\n  → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`);
  });

  // 优雅退出
  let shuttingDown = false;
  function shutdown(sig) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown', { signal: sig });
    watcher.close();
    monitor.close();
    sseHub.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
