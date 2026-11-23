'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const chokidar = require('chokidar');
const { XMLParser } = require('fast-xml-parser');
const { INCOMPLETE_XML, FILE_TOO_LARGE } = require('./parser');

const CFG_INI = 'ljdds_monitor_service_cfg.ini';
const DOMAIN_XML = 'ljdds_monitor_service_domaincfg.xml';
const TOPIC_XML = 'ljdds_monitor_service_topiccfg.xml';

// 监控端输出 XML 命名：ljdds_monitor_service_data-<start_time>-<当前时间>.xml
const OUTPUT_RE = /^ljdds_monitor_service_data-.*\.xml$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

// ---------------------------------------------------------------------------
// 监控端对接服务：负责 3 个配置文件的读写、启动/停止、输出目录监听（读新 XML、删旧）、
// 当前 XML 保存。解析复用 parser.parse + store.add，天然进入现有聚合/SSE 管线。
// ---------------------------------------------------------------------------
class MonitorService extends EventEmitter {
  constructor(configManager, parser, store) {
    super();
    this.configManager = configManager;
    this.parser = parser;
    this.store = store;

    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      ignoreDeclaration: true,
      trimValues: false,
      parseTagValue: false,
      parseAttributeValue: false,
    });

    this.watcher = null;
    this._pending = new Map();     // filePath -> timeout（防抖）
    this._currentFile = null;      // 已导入的最新 XML 文件名
    this._currentFilePath = null;  // 其绝对路径
    this._lastImport = null;
    this._running = false;
    this._lastStartAt = null;
    this._lastStopAt = null;
    this._outputDir = null;

    // 若配置已存在，冷启动即监听输出目录（读入已有 XML）
    this._refreshOutputWatch();
  }

  // ---- 路径 ----
  get serviceDir() { return this.configManager.resolveMonitorServiceDir(); }
  get configDir() { return this.configManager.resolveMonitorConfigDir(); }
  get outputBase() { return this.configManager.resolveMonitorOutputBase(); }
  get saveBase() { return this.configManager.resolveMonitorSaveBase(); }

  _monitorCfg() { return this.configManager.get().monitor || {}; }

  _outputDirFor(projectName, startTime) {
    return path.join(this.outputBase, String(projectName || ''), String(startTime || ''));
  }

  // ---- 配置读取 ----
  _readIni() {
    const file = path.join(this.configDir, CFG_INI);
    const out = {};
    try {
      if (!fs.existsSync(file)) return out;
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const s = line.trim();
        if (!s || s.startsWith(';') || s.startsWith('#') || s.startsWith('//')) continue;
        const idx = s.indexOf('=');
        if (idx <= 0) continue;
        out[s.slice(0, idx).trim()] = s.slice(idx + 1).trim();
      }
    } catch (_) { /* 读取失败按未配置处理 */ }
    return out;
  }

  _readDomainXml() {
    const file = path.join(this.configDir, DOMAIN_XML);
    try {
      if (!fs.existsSync(file)) return [];
      const tree = this.xmlParser.parse(fs.readFileSync(file, 'utf8'));
      const root = tree.ljdds_monitor_service || tree;
      return toArray(root.domain)
        .map((d) => ({
          value: d['@_value'] != null ? String(d['@_value']).trim() : '',
          multicast_address: d['@_multicast_address'] != null ? String(d['@_multicast_address']).trim() : '',
        }))
        .filter((d) => d.value !== '');
    } catch (_) { return []; }
  }

  _readTopicXml() {
    const file = path.join(this.configDir, TOPIC_XML);
    try {
      if (!fs.existsSync(file)) return { mode: 'any', topics: [] };
      const tree = this.xmlParser.parse(fs.readFileSync(file, 'utf8'));
      const root = tree.ljdds_monitor_service || tree;
      const mt = root.monitor_topic || {};
      const mode = mt['@_mode'] != null ? String(mt['@_mode']) : 'any';
      const topics = toArray(mt.topic)
        .map((t) => (t['@_name'] != null ? String(t['@_name']).trim() : ''))
        .filter(Boolean);
      return { mode, topics };
    } catch (_) { return { mode: 'any', topics: [] }; }
  }

  // 归一化当前磁盘配置 + 校验结果
  getConfig() {
    const ini = this._readIni();
    const domains = this._readDomainXml();
    const topic = this._readTopicXml();

    const projectName = ini.project_name != null ? String(ini.project_name).trim() : '';
    const startTime = ini.start_time != null ? String(ini.start_time).trim() : '';
    const refreshPeriod = ini.refresh_period != null && ini.refresh_period !== ''
      ? Number(ini.refresh_period) : 60;
    const isSelf = ini.is_self != null && ini.is_self !== '' ? ini.is_self : 0;

    const missing = [];
    if (!projectName) missing.push('project_name');
    if (!startTime) missing.push('start_time');
    if (!domains.length) missing.push('至少一个域');

    return {
      project_name: projectName,
      start_time: startTime,
      refresh_period: Number.isFinite(refreshPeriod) ? refreshPeriod : 60,
      is_self: isSelf,
      domains,
      topic_mode: topic.mode,
      topics: topic.topics,
      valid: missing.length === 0,
      missing,
    };
  }

  // ---- 配置写入 ----
  _normalizeDomains(input) {
    const out = [];
    const seen = new Set();
    for (const d of Array.isArray(input) ? input : []) {
      let value = '';
      let mc = '';
      if (d && typeof d === 'object') {
        value = d.value != null ? String(d.value).trim() : '';
        mc = d.multicast_address != null ? String(d.multicast_address).trim()
          : (d.multicastAddress != null ? String(d.multicastAddress).trim() : '');
      } else if (d != null) {
        value = String(d).trim();
      }
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push({ value, multicast_address: mc || this._defaultMulticast(value) });
    }
    return out;
  }

  _defaultMulticast(value) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 255) return `239.255.${Math.floor(n)}.1`;
    return value;
  }

  _normalizeTopics(input) {
    const out = [];
    const seen = new Set();
    for (const t of Array.isArray(input) ? input : []) {
      const name = t && typeof t === 'object'
        ? (t.name != null ? String(t.name).trim() : '')
        : (t != null ? String(t).trim() : '');
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }

  _validate(cfg) {
    const missing = [];
    if (!cfg.project_name) missing.push('project_name');
    if (!cfg.start_time) missing.push('start_time');
    if (!cfg.domains.length) missing.push('至少一个域');
    if (missing.length) {
      return { ok: false, code: 'CONFIG_INVALID', message: `请先完成监控配置（缺少：${missing.join('、')}）`, missing };
    }
    return null;
  }

  writeConfig(input) {
    const src = input || {};
    const cfg = {
      project_name: src.project_name != null ? String(src.project_name).trim() : '',
      start_time: src.start_time != null ? String(src.start_time).trim() : '',
      refresh_period: src.refresh_period != null && src.refresh_period !== '' ? Number(src.refresh_period) : 60,
      is_self: src.is_self != null && src.is_self !== '' ? src.is_self : 0,
      domains: this._normalizeDomains(src.domains),
      topics: this._normalizeTopics(src.topics),
    };
    if (!Number.isFinite(cfg.refresh_period) || cfg.refresh_period < 1) cfg.refresh_period = 60;

    const err = this._validate(cfg);
    if (err) return err;

    try {
      fs.mkdirSync(this.configDir, { recursive: true });
      this._atomicWrite(path.join(this.configDir, CFG_INI), this._buildIni(cfg));
      this._atomicWrite(path.join(this.configDir, DOMAIN_XML), this._buildDomainXml(cfg.domains));
      this._atomicWrite(path.join(this.configDir, TOPIC_XML), this._buildTopicXml(cfg.topics));
    } catch (e) {
      return { ok: false, code: 'WRITE_FAILED', message: '写入配置文件失败：' + e.message };
    }

    this._refreshOutputWatch();
    this.emit('monitor', this.status());
    return { ok: true, config: this.getConfig() };
  }

  // 仅转义 & < "；">" 在属性值中可原样保留（主题名常含 ->，如 02B1->FF15）
  _xmlEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  _buildIni(cfg) {
    return [
      `project_name=${cfg.project_name}`,
      `start_time=${cfg.start_time}`,
      `refresh_period=${cfg.refresh_period}`,
      `is_self=${cfg.is_self}`,
      '',
    ].join('\n');
  }

  _buildDomainXml(domains) {
    const rows = domains
      .map((d) => `    <domain multicast_address="${this._xmlEscape(d.multicast_address)}" value="${this._xmlEscape(d.value)}"/>`)
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<ljdds_monitor_service>\n${rows}\n</ljdds_monitor_service>\n`;
  }

  _buildTopicXml(topics) {
    if (!topics.length) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<ljdds_monitor_service>\n    <monitor_topic mode="any"/>\n</ljdds_monitor_service>\n`;
    }
    const rows = topics.map((t) => `        <topic name="${this._xmlEscape(t)}"/>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<ljdds_monitor_service>\n    <monitor_topic mode="any">\n${rows}\n    </monitor_topic>\n</ljdds_monitor_service>\n`;
  }

  _atomicWrite(file, content) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  }

  // ---- 启动 / 停止 ----
  _run(scriptName) {
    const serviceDir = this.serviceDir;
    const scriptPath = path.join(serviceDir, scriptName);
    if (!fs.existsSync(serviceDir)) {
      return { ok: false, code: 'SERVICE_NOT_FOUND', message: `未找到监控端目录：${serviceDir}` };
    }
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, code: 'SERVICE_NOT_FOUND', message: `未找到脚本：${scriptPath}` };
    }
    const useShell = this._monitorCfg().shell !== false;
    let child;
    try {
      if (useShell && process.platform === 'win32') {
        child = spawn('cmd.exe', ['/d', '/s', '/c', scriptPath], { cwd: serviceDir, windowsHide: true });
      } else {
        child = spawn(scriptPath, [], { cwd: serviceDir, shell: true, windowsHide: true });
      }
    } catch (err) {
      return { ok: false, code: 'SPAWN_FAILED', message: err.message };
    }
    child.on('error', (err) => {
      this.emit('alert', { level: 'error', message: `监控端脚本执行失败：${err.message}` });
    });
    if (child.unref) child.unref();
    return { ok: true, pid: child.pid };
  }

  start() {
    const cfg = this.getConfig();
    if (!cfg.valid) {
      return { ok: false, code: 'CONFIG_INVALID', message: `请先完成监控配置（缺少：${cfg.missing.join('、')}）`, missing: cfg.missing };
    }
    const r = this._run(this._monitorCfg().startScript);
    if (r.ok) {
      this._running = true;
      this._lastStartAt = new Date().toISOString();
      this.emit('monitor', this.status());
    }
    return r;
  }

  stop() {
    this._running = false;
    this._lastStopAt = new Date().toISOString();
    const r = this._run(this._monitorCfg().stopScript);
    this.emit('monitor', this.status());
    return r;
  }

  // ---- 输出目录监听 ----
  _refreshOutputWatch() {
    const c = this.getConfig();
    const dir = this._outputDirFor(c.project_name, c.start_time);
    this._outputDir = dir;
    this._closeWatcher();
    if (!c.project_name || !c.start_time) return; // 未配置，不监听

    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }

    const watcher = chokidar.watch(dir, {
      ignoreInitial: false,              // 冷启动读入已有 XML
      persistent: true,
      awaitWriteFinish: {                // 写入稳定判定（防半截）
        stabilityThreshold: 400,
        pollInterval: 100,
      },
    });
    watcher
      .on('add', (p) => this._onOutputFile(p))
      .on('change', (p) => this._onOutputFile(p))
      .on('error', (err) => this.emit('alert', { level: 'error', message: '监控端输出监听错误：' + err.message }));
    this.watcher = watcher;
  }

  _closeWatcher() {
    if (this.watcher) {
      try { this.watcher.close(); } catch (_) { /* ignore */ }
      this.watcher = null;
    }
  }

  _onOutputFile(filePath) {
    if (!/\.xml$/i.test(filePath)) return;
    if (this._pending.has(filePath)) clearTimeout(this._pending.get(filePath));
    const t = setTimeout(() => {
      this._pending.delete(filePath);
      this._processOutput(filePath, 0);
    }, 60);
    this._pending.set(filePath, t);
  }

  async _processOutput(filePath, attempt) {
    if (attempt >= 4) {
      this.emit('alert', { level: 'error', message: '监控端 XML 持续不稳定，已放弃：' + path.basename(filePath), file: filePath });
      return;
    }
    try {
      const s1 = await this._stat(filePath);
      if (!s1 || s1.size === 0) return this._retry(filePath, attempt);

      await sleep(80);
      const s2 = await this._stat(filePath);
      if (!this._stable(s1, s2)) return this._retry(filePath, attempt);

      const buf = await fs.promises.readFile(filePath);
      const s3 = await this._stat(filePath);
      if (!this._stable(s2, s3)) return this._retry(filePath, attempt);

      const fileMeta = {
        filePath,
        fileName: path.basename(filePath),
        size: s3.size,
        mtimeMs: s3.mtimeMs,
        mtimeIso: new Date(s3.mtimeMs).toISOString(),
        receivedAt: new Date().toISOString(),
      };

      const records = this.parser.parse(buf, fileMeta);
      let added = 0;
      for (const r of records) if (this.store.add(r)) added++;

      this._currentFilePath = filePath;
      this._currentFile = path.basename(filePath);
      this._lastImport = { file: this._currentFile, parsed: records.length, added, at: new Date().toISOString() };

      this.emit('monitor', this.status());

      if (this._monitorCfg().autoDeleteOld !== false) this._deleteOld(filePath);
    } catch (err) {
      if (err.code === INCOMPLETE_XML) return this._retry(filePath, attempt);
      if (err.code === FILE_TOO_LARGE) {
        this.emit('alert', { level: 'error', message: err.message, file: filePath });
        return;
      }
      this.emit('alert', { level: 'error', message: '解析失败：' + err.message, file: filePath });
    }
  }

  _retry(filePath, attempt) {
    const backoff = [150, 300, 600, 1200][attempt] || 1200;
    setTimeout(() => this._processOutput(filePath, attempt + 1), backoff);
  }

  async _stat(p) {
    try { return await fs.promises.stat(p); } catch (_) { return null; }
  }

  _stable(a, b) {
    if (!a || !b) return false;
    return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
  }

  // 删除输出目录下比当前文件更旧的 XML（只保留最新一份，避免前端反复感知更新）
  _deleteOld(keepPath) {
    const dir = path.dirname(keepPath);
    fs.promises.readdir(dir).then(async (names) => {
      let keepStat = null;
      try { keepStat = await fs.promises.stat(keepPath); } catch (_) { return; }
      for (const name of names) {
        if (!OUTPUT_RE.test(name)) continue;
        const full = path.join(dir, name);
        if (full === keepPath) continue;
        try {
          const s = await fs.promises.stat(full);
          if (s.mtimeMs < keepStat.mtimeMs) await fs.promises.unlink(full);
        } catch (_) { /* ignore */ }
      }
    }).catch(() => {});
  }

  // ---- 保存当前 XML ----
  saveCurrent(dest) {
    if (!this._currentFilePath || !fs.existsSync(this._currentFilePath)) {
      return { ok: false, code: 'NO_CURRENT_FILE', message: '暂无已导入的 XML 文件' };
    }
    let target = dest != null ? String(dest).trim() : '';
    if (!target) {
      const c = this.getConfig();
      target = path.join(this.saveBase, String(c.project_name || ''), String(c.start_time || ''), this._currentFile);
    } else if (!path.isAbsolute(target)) {
      target = path.resolve(this.configManager.rootDir, target);
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(this._currentFilePath, target);
      return { ok: true, from: this._currentFilePath, to: target };
    } catch (e) {
      return { ok: false, code: 'SAVE_FAILED', message: '保存失败：' + e.message };
    }
  }

  // ---- 状态 / 文件清单 ----
  status() {
    const serviceDir = this.serviceDir;
    const m = this._monitorCfg();
    return {
      running: this._running,
      serviceDir,
      configDir: this.configDir,
      outputDir: this._outputDir,
      saveBase: this.saveBase,
      serviceExists: fs.existsSync(serviceDir),
      startScript: path.join(serviceDir, m.startScript),
      stopScript: path.join(serviceDir, m.stopScript),
      currentFile: this._currentFile,
      lastImport: this._lastImport,
      lastStartAt: this._lastStartAt,
      lastStopAt: this._lastStopAt,
      config: this.getConfig(),
    };
  }

  listFiles() {
    const dir = this._outputDir;
    let files = [];
    try {
      if (dir) files = fs.readdirSync(dir).filter((n) => /\.xml$/i.test(n)).sort();
    } catch (_) { /* ignore */ }
    return { dir, files };
  }

  close() {
    this._closeWatcher();
    for (const t of this._pending.values()) clearTimeout(t);
    this._pending.clear();
  }
}

module.exports = { MonitorService, OUTPUT_RE };
