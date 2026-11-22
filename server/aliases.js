'use strict';

const fs = require('fs');
const path = require('path');

// IP 节点别名存储：内存 Map + JSON 文件持久化（需求 3：前端可给 ip 节点配置别名）。
// 持久化路径相对项目根解析（config.aliasesFile，默认 ./data/aliases.json）。
class AliasStore {
  constructor(configManager) {
    this.configManager = configManager;
    this.aliases = new Map();
    this.file = this._resolveFile();
    this._load();
  }

  _resolveFile() {
    const cfg = this.configManager.get();
    const f = cfg.aliasesFile || './data/aliases.json';
    return path.isAbsolute(f) ? f : path.resolve(this.configManager.rootDir, f);
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const obj = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (obj && typeof obj === 'object') {
        for (const [ip, alias] of Object.entries(obj)) {
          if (alias != null && String(alias).trim() !== '') this.aliases.set(ip, String(alias));
        }
      }
    } catch (_) {
      // 别名文件损坏时静默忽略，不影响主流程
    }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const obj = Object.fromEntries(this.aliases.entries());
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (_) {
      // 持久化失败不影响内存态
    }
  }

  getAll() {
    return Object.fromEntries(this.aliases.entries());
  }

  set(ip, alias) {
    if (!ip || !String(ip).trim()) return { ok: false, code: 'INVALID_IP', message: '缺少 IP' };
    const a = alias == null ? '' : String(alias).trim();
    if (a === '') {
      this.aliases.delete(String(ip).trim());
    } else {
      this.aliases.set(String(ip).trim(), a);
    }
    this._persist();
    return { ok: true, aliases: this.getAll() };
  }

  remove(ip) {
    if (ip != null) this.aliases.delete(String(ip).trim());
    this._persist();
    return { ok: true, aliases: this.getAll() };
  }
}

module.exports = { AliasStore };
