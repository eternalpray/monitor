'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

// SSE 客户端池：单向推送 + 心跳保活 + 断线清理。
class SseHub extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // clientId -> { res, lastPing }
    this.heartbeatTimer = null;
  }

  addClient(req, res) {
    const clientId = crypto.randomBytes(8).toString('hex');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    const client = { id: clientId, res, lastPing: Date.now() };
    this.clients.set(clientId, client);

    req.on('close', () => this._remove(clientId));
    res.on('error', () => this._remove(clientId));

    this.emit('connected', clientId);
    this._ensureHeartbeat();
    return clientId;
  }

  _remove(clientId) {
    const c = this.clients.get(clientId);
    if (!c) return;
    try { c.res.end(); } catch (_) { /* ignore */ }
    this.clients.delete(clientId);
    this.emit('closed', clientId);
    if (this.clients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _ensureHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.broadcast('heartbeat', { t: Date.now() });
      this.writeComment('ping');
    }, 15000);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  writeComment(text) {
    for (const c of this.clients.values()) {
      try { c.res.write(`: ${text}\n\n`); } catch (_) { this._remove(c.id); }
    }
  }

  send(clientId, event, data) {
    const c = this.clients.get(clientId);
    if (!c) return false;
    try {
      c.res.write(`event: ${event}\n`);
      c.res.write(`id: ${Date.now()}\n`);
      c.res.write(`data: ${JSON.stringify(data)}\n\n`);
      c.lastPing = Date.now();
      return true;
    } catch (_) {
      this._remove(clientId);
      return false;
    }
  }

  broadcast(event, data) {
    for (const c of this.clients.values()) {
      this.send(c.id, event, data);
    }
  }

  count() {
    return this.clients.size;
  }

  close() {
    for (const id of Array.from(this.clients.keys())) this._remove(id);
  }
}

module.exports = { SseHub };
