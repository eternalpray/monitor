import React, { useEffect, useState } from 'react';

const CONN_LABEL = {
  connecting: '连接中…',
  connected: '已连接',
  reconnecting: '重连中…',
  disconnected: '已断开',
};

function uptime(sec) {
  if (!sec && sec !== 0) return '—';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function TopBar({ connState, watcher, stats, onRescan, onDemo, onDemoSlow, onClear, onConfig }) {
  const [showSettings, setShowSettings] = useState(false);
  const [watchDir, setWatchDir] = useState('');
  const [uptimeSec, setUptimeSec] = useState(0);

  useEffect(() => {
    apiHealth();
    const t = setInterval(apiHealth, 5000);
    return () => clearInterval(t);
  }, []);
  function apiHealth() {
    fetch('/api/health').then((r) => r.json()).then((b) => b.ok && setUptimeSec(b.uptimeSec)).catch(() => {});
  }

  useEffect(() => { if (watcher) setWatchDir(watcher.dir || ''); }, [watcher]);

  function save() {
    onConfig({ watchDir });
    setShowSettings(false);
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="brand">DDS 轻量监控工具</span>
        <span className={`conn-badge conn-${connState}`}>
          <span className="dot" />{CONN_LABEL[connState] || connState}
        </span>
      </div>

      <div className="topbar-meta">
        <span className="meta">监听目录：<code>{watcher ? watcher.dir : '—'}</code></span>
        <span className="meta">文件：{stats ? stats.fileCount : '—'}</span>
        <span className="meta">运行：{uptime(uptimeSec)}</span>
      </div>

      <div className="topbar-actions">
        <button onClick={onRescan}>重扫</button>
        <button onClick={onDemo}>演示数据</button>
        <button onClick={onDemoSlow}>慢速写入</button>
        <button onClick={onClear}>清空</button>
        <button onClick={() => setShowSettings((s) => !s)}>设置</button>
      </div>

      {showSettings && (
        <div className="settings-panel">
          <label>监听目录（热更新，无需重启）
            <input value={watchDir} onChange={(e) => setWatchDir(e.target.value)} placeholder="./data/incoming" />
          </label>
          <div className="settings-actions">
            <button onClick={save}>保存</button>
            <button onClick={() => setShowSettings(false)}>取消</button>
          </div>
        </div>
      )}
    </header>
  );
}
