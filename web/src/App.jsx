import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { api, subscribe } from './api.js';
import TopBar from './components/TopBar.jsx';
import OverviewCards from './components/OverviewCards.jsx';
import TrendChart from './components/TrendChart.jsx';
import Distribution from './components/Distribution.jsx';
import FilterBar from './components/FilterBar.jsx';
import RecordsTable from './components/RecordsTable.jsx';
import DetailDrawer from './components/DetailDrawer.jsx';
import AlertBar from './components/AlertBar.jsx';

const MAX_CLIENT_RECORDS = 5000;

export default function App() {
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState(null);
  const [config, setConfig] = useState(null);
  const [watcher, setWatcher] = useState(null);
  const [connState, setConnState] = useState('connecting');
  const [alerts, setAlerts] = useState([]);
  const [filters, setFilters] = useState({ node: '', topic: '', status: '', q: '', paused: false });
  const [selected, setSelected] = useState(null);
  const [metricNames, setMetricNames] = useState([]);
  const [series, setSeries] = useState({ metric: null, points: [] });

  const seenIds = useRef(new Set());

  const mergeRecords = useCallback((incoming) => {
    if (!Array.isArray(incoming) || !incoming.length) return;
    setRecords((prev) => {
      const fresh = incoming.filter((r) => !seenIds.current.has(r.id));
      for (const r of fresh) seenIds.current.add(r.id);
      if (!fresh.length) return prev;
      const next = [...fresh, ...prev];
      // 客户端也做环形裁剪，避免内存增长
      if (next.length > MAX_CLIENT_RECORDS) {
        const removed = next.slice(MAX_CLIENT_RECORDS);
        for (const r of removed) seenIds.current.delete(r.id);
        return next.slice(0, MAX_CLIENT_RECORDS);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const sub = subscribe({
      hello: () => setConnState('connected'),
      snapshot: (data) => {
        seenIds.current = new Set();
        if (Array.isArray(data.records)) {
          const ids = data.records.map((r) => r.id);
          seenIds.current = new Set(ids);
          setRecords(data.records);
        }
        setStats(data.stats);
        setConfig(data.config);
        setWatcher(data.watcher);
        setConnState('connected');
      },
      records: (data) => mergeRecords(data.records),
      stats: (d) => setStats(d),
      watcher: (d) => setWatcher(d),
      alert: (d) => setAlerts((prev) => [{ id: Date.now() + '-' + Math.random(), ...d }, ...prev].slice(0, 50)),
      onState: (s) => setConnState(s === 'connected' ? 'connected' : 'reconnecting'),
    });
    return () => sub.close();
  }, [mergeRecords]);

  // 初次加载指标名
  useEffect(() => {
    api.metrics().then((r) => setMetricNames(r.metrics || [])).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (filters.node && r.node !== filters.node) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.topic && !(r.topics || []).some((t) => t.name === filters.topic)) return false;
      if (filters.q) {
        const hay = `${r.node} ${r.domain} ${r.status} ${r.kind} ${r.typeName || ''} ${(r.topics || []).map((t) => t.name).join(' ')} ${r.fileName}`.toLowerCase();
        if (!hay.includes(filters.q.toLowerCase())) return false;
      }
      return true;
    });
  }, [records, filters]);

  const nodes = useMemo(() => Object.keys((stats && stats.nodeDistribution) || {}).sort(), [stats]);
  const topics = useMemo(() => Object.keys((stats && stats.topicDistribution) || {}).sort(), [stats]);

  const loadSeries = useCallback((metric) => {
    if (!metric) { setSeries({ metric: null, points: [] }); return; }
    api.series(metric).then((r) => setSeries({ metric, points: r.points || [] })).catch(() => {});
  }, []);

  const doAction = useCallback(async (fn, okMsg) => {
    try { await fn(); if (okMsg) setAlerts((p) => [{ id: Date.now(), level: 'info', message: okMsg }, ...p].slice(0, 50)); }
    catch (e) { setAlerts((p) => [{ id: Date.now(), level: 'error', message: e.message }, ...p].slice(0, 50)); }
  }, []);

  return (
    <div className="app">
      <TopBar
        connState={connState}
        watcher={watcher}
        stats={stats}
        onRescan={() => doAction(() => api.scan(), '已触发全量重扫')}
        onDemo={() => doAction(() => api.demoEmit(1), '已生成演示数据')}
        onDemoSlow={() => doAction(() => api.demoSlow(), '已启动慢速写入验证')}
        onClear={() => doAction(() => api.clear(), '已清空缓冲')}
        onConfig={(patch) => doAction(() => api.updateConfig(patch), '配置已更新')}
      />

      <AlertBar alerts={alerts} onDismiss={(id) => setAlerts((p) => p.filter((a) => a.id !== id))} />

      <OverviewCards stats={stats} />

      <div className="mid-grid">
        <TrendChart metricNames={metricNames} series={series} onSelect={loadSeries} />
        <Distribution stats={stats} />
      </div>

      <FilterBar
        filters={filters}
        setFilters={setFilters}
        nodes={nodes}
        topics={topics}
        total={records.length}
        shown={filtered.length}
      />

      <RecordsTable records={filtered} onSelect={setSelected} />

      {selected && <DetailDrawer record={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
