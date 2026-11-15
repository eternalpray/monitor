'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  host: '0.0.0.0',
  port: 7788,
  watchDir: './data/incoming',
  recursive: true,
  bufferSize: 5000,
  detailRetainCount: 500,
  stabilityThreshold: 400,
  pollInterval: 100,
  debounceMs: 60,
  readRecheckDelay: 80,
  maxRetries: 4,
  retryBackoffMs: [150, 300, 600, 1200],
  maxXmlPreviewBytes: 32768,
  maxFileSize: 2097152,
  maxMetricsPerRecord: 160,
  maxTopicsPerRecord: 40,
  maxParseDepth: 64,
  ignorePatterns: [],
  fieldAliases: {},
  statusMapping: {},
  split: { enabled: false, recordPaths: [], context: [] },
  numericMetricExclude: [],
};

const NUM_KEYS = [
  'port', 'bufferSize', 'detailRetainCount', 'stabilityThreshold', 'pollInterval',
  'debounceMs', 'readRecheckDelay', 'maxRetries', 'maxXmlPreviewBytes', 'maxFileSize',
  'maxMetricsPerRecord', 'maxTopicsPerRecord', 'maxParseDepth',
];

class ConfigManager {
  constructor(rootDir, configPath) {
    this.rootDir = rootDir;
    this.configPath = configPath;
    this.watcher = null;
    this.onWatcherDirChange = null;
    this.config = this._load();
  }

  _load() {
    let fileCfg = {};
    if (fs.existsSync(this.configPath)) {
      try {
        fileCfg = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      } catch (err) {
        throw new Error(`配置文件解析失败 ${this.configPath}: ${err.message}`);
      }
    }
    const merged = Object.assign({}, DEFAULTS, fileCfg);

    // 环境变量覆盖（优先级最高）
    if (process.env.PORT) merged.port = Number(process.env.PORT) || merged.port;
    if (process.env.HOST) merged.host = process.env.HOST;
    if (process.env.DDS_WATCH_DIR) merged.watchDir = process.env.DDS_WATCH_DIR;

    this._validate(merged);
    return merged;
  }

  _validate(cfg) {
    const numErr = NUM_KEYS.filter((k) => cfg[k] != null && (typeof cfg[k] !== 'number' || Number.isNaN(cfg[k])));
    if (numErr.length) throw new Error(`配置参数必须为数字: ${numErr.join(', ')}`);
    if (!Number.isInteger(cfg.bufferSize) || cfg.bufferSize < 1) throw new Error('bufferSize 必须为正整数');
    if (!Number.isInteger(cfg.maxRetries) || cfg.maxRetries < 0) throw new Error('maxRetries 必须为非负整数');
    if (!Array.isArray(cfg.ignorePatterns)) throw new Error('ignorePatterns 必须为数组');
    if (!Array.isArray(cfg.retryBackoffMs)) throw new Error('retryBackoffMs 必须为数组');
  }

  // 相对路径基于项目根解析
  resolveWatchDir(dir) {
    const d = dir || this.config.watchDir;
    return path.isAbsolute(d) ? d : path.resolve(this.rootDir, d);
  }

  get() {
    return this.config;
  }

  // 对外暴露（脱敏/浅拷贝，避免调用方误改内部对象）
  public() {
    const c = this.config;
    return {
      host: c.host,
      port: c.port,
      watchDir: c.watchDir,
      recursive: c.recursive,
      bufferSize: c.bufferSize,
      detailRetainCount: c.detailRetainCount,
      stabilityThreshold: c.stabilityThreshold,
      pollInterval: c.pollInterval,
      debounceMs: c.debounceMs,
      readRecheckDelay: c.readRecheckDelay,
      maxRetries: c.maxRetries,
      maxXmlPreviewBytes: c.maxXmlPreviewBytes,
      maxFileSize: c.maxFileSize,
      ignorePatterns: c.ignorePatterns.slice(),
      fieldAliases: c.fieldAliases,
    };
  }

  // 热更新：仅允许修改监听目录与若干防护参数；校验通过才生效
  update(patch) {
    if (!patch || typeof patch !== 'object') {
      return { ok: false, code: 'INVALID_CONFIG', message: '请求体必须为 JSON 对象' };
    }
    const allowed = ['watchDir', 'stabilityThreshold', 'pollInterval', 'debounceMs', 'bufferSize', 'detailRetainCount', 'recursive'];
    const next = Object.assign({}, this.config);
    for (const k of Object.keys(patch)) {
      if (!allowed.includes(k)) {
        return { ok: false, code: 'INVALID_CONFIG', message: `不允许修改配置项: ${k}` };
      }
      if (patch[k] === undefined || patch[k] === '') continue;
      next[k] = patch[k];
    }

    // 目录合法性校验
    if (next.watchDir) {
      const abs = this.resolveWatchDir(next.watchDir);
      if (!abs || typeof abs !== 'string') {
        return { ok: false, code: 'INVALID_WATCH_DIR', message: '监听目录非法' };
      }
    }

    try {
      this._validate(next);
    } catch (err) {
      return { ok: false, code: 'INVALID_CONFIG', message: err.message };
    }

    const watchDirChanged = next.watchDir !== this.config.watchDir;
    this.config = next;

    // 目录变化 → 触发监听器重建（无需重启进程）
    if (watchDirChanged && this.onWatcherDirChange) {
      this.onWatcherDirChange(this.resolveWatchDir(next.watchDir));
    }
    return { ok: true, config: this.public() };
  }

  attachWatcher(watcher) {
    this.watcher = watcher;
    this.onWatcherDirChange = (dir) => watcher && watcher.setWatchDir(dir);
  }
}

module.exports = { ConfigManager, DEFAULTS };
