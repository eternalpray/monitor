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
import DomainList from './components/DomainList.jsx';
import DomainDetail from './components/DomainDetail.jsx';
import ParticipantDetail from './components/ParticipantDetail.jsx';
import TopicDetail from './components/TopicDetail.jsx';

const MAX_CLIENT_RECORDS = 5000;

export default function App() {
  const [domains, setDomains] = useState([]);
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
  const [showLive, setShowLive] = useState(false);
  const [revision, setRevision] = useState(0);

  // 抽屉层级：L1 = openDomain；L2 = openParticipant 或 openTopic
  const [openDomain, setOpenDomain] = useState(null);
  const [openParticipant, setOpenParticipant] = useState(null);
  const [openTopic, setOpenTopic] = useState(null);

  const seenIds = useRef(new Set());

  const mergeRecords = useCallback((incoming) => {
    if (!Array.isArray(incoming) || !incoming.length) return;
    setRecords((prev) => {
      const fresh = incoming.filter((r) => !seenIds.current.has(r.id));
      for (const r of fresh) seenIds.current.add(r.id);
      if (!fresh.length) return prev;
      const next = [...fresh, ...prev];
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
          seenIds.current = new Set(data.records.map((r) => r.id));
          setRecords(data.records);
        }
        if (Array.isArray(data.domains)) setDomains(data.domains);
        setStats(data.stats);
        setConfig(data.config);
        setWatcher(data.watcher);
        setConnState('connected');
      },
      records: (data) => mergeRecords(data.records),
      stats: (d) => setStats(d),
      watcher: (d) => setWatcher(d),
      domains: (d) => {
        if (Array.isArray(d.domains)) setDomains(d.domains);
        setRevision((r) => r + 1);
      },
      domainDetail: () => setRevision((r) => r + 1),
      alert: (d) => setAlerts((prev) => [{ id: Date.now() + '-' + Math.random(), ...d }, ...prev].slice(0, 50)),
      onState: (s) => setConnState(s === 'connected' ? 'connected' : 'reconnecting'),
    });
    return () => sub.close();
  }, [mergeRecords]);

  useEffect(() => {
    api.metrics().then((r) => setMetricNames(r.metrics || [])).catch(() => {});
  }, []);

  // ESC 逐级关闭抽屉（DR-2）
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (openParticipant) { setOpenParticipant(null); return; }
      if (openTopic) { setOpenTopic(null); return; }
      if (openDomain) setOpenDomain(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDomain, openParticipant, openTopic]);

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

  const openParticipantAt = useCallback((guid) => {
    setOpenTopic(null);
    setOpenParticipant({ domainId: openDomain, guid });
  }, [openDomain]);

  const openTopicAt = useCallback((name) => {
    setOpenParticipant(null);
    setOpenTopic({ domainId: openDomain, name });
  }, [openDomain]);

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

      <OverviewCards domains={domains} stats={stats} />

      <DomainList domains={domains} onOpen={setOpenDomain} />

      <div className="aux-toggle">
        <button onClick={() => setShowLive((s) => !s)}>
          {showLive ? '▾' : '▸'} 实时数据流 / 趋势（辅助）
        </button>
      </div>
      {showLive && (
        <>
          <div className="mid-grid">
            <TrendChart metricNames={metricNames} series={series} onSelect={loadSeries} />
            <Distribution stats={stats} />
          </div>
          <FilterBar filters={filters} setFilters={setFilters} nodes={nodes} topics={topics} total={records.length} shown={filtered.length} />
          <RecordsTable records={filtered} onSelect={setSelected} />
        </>
      )}

      {openDomain && (
        <DomainDetail
          domainId={openDomain}
          revision={revision}
          onClose={() => setOpenDomain(null)}
          onOpenParticipant={openParticipantAt}
          onOpenTopic={openTopicAt}
        />
      )}

      {openParticipant && (
        <ParticipantDetail
          domainId={openParticipant.domainId}
          guid={openParticipant.guid}
          onClose={() => { setOpenParticipant(null); setOpenDomain(null); }}
          onBack={() => setOpenParticipant(null)}
          onOpenTopic={openTopicAt}
        />
      )}

      {openTopic && (
        <TopicDetail
          domainId={openTopic.domainId}
          name={openTopic.name}
          onClose={() => { setOpenTopic(null); setOpenDomain(null); }}
          onBack={() => setOpenTopic(null)}
        />
      )}

      {selected && <DetailDrawer record={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
