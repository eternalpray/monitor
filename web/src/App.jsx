import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { api, subscribe } from './api.js';
import { TopicRadixContext, DEFAULT_RADIX } from './topicName.js';
import { AliasContext } from './aliases.js';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import OverviewCards from './components/OverviewCards.jsx';
import AlertBar from './components/AlertBar.jsx';
import DomainList from './components/DomainList.jsx';
import DomainDetail from './components/DomainDetail.jsx';
import TopicListView from './components/TopicListView.jsx';
import IpTopicsView from './components/IpTopicsView.jsx';
import TopicDetail from './components/TopicDetail.jsx';
import ParticipantDetail from './components/ParticipantDetail.jsx';
import IpDetail from './components/IpDetail.jsx';
import DetailPanel from './components/DetailPanel.jsx';

export default function App() {
  const [domains, setDomains] = useState([]);
  const [stats, setStats] = useState(null);
  const [watcher, setWatcher] = useState(null);
  const [connState, setConnState] = useState('connecting');
  const [alerts, setAlerts] = useState([]);
  const [revision, setRevision] = useState(0);
  const [aliases, setAliases] = useState({});

  const [radix, setRadix] = useState(DEFAULT_RADIX);
  const [view, setView] = useState({ kind: 'overview' });
  const [selection, setSelection] = useState(null);

  const navigate = useCallback((next) => { setView(next); setSelection(null); }, []);

  const loadAliases = useCallback(() => {
    api.aliases().then((r) => setAliases(r.aliases || {})).catch(() => {});
  }, []);

  const setAlias = useCallback(async (ip, alias) => {
    const r = await api.setAlias(ip, alias);
    setAliases(r.aliases || {});
  }, []);

  const deleteAlias = useCallback(async (ip) => {
    const r = await api.deleteAlias(ip);
    setAliases(r.aliases || {});
  }, []);

  useEffect(() => { loadAliases(); }, [loadAliases]);

  useEffect(() => {
    const sub = subscribe({
      hello: () => setConnState('connected'),
      snapshot: (data) => {
        if (Array.isArray(data.domains)) setDomains(data.domains);
        setStats(data.stats);
        setWatcher(data.watcher);
        setConnState('connected');
      },
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
  }, []);

  // ESC 关闭右侧详情
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelection(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const doAction = useCallback(async (fn, okMsg) => {
    try { await fn(); if (okMsg) setAlerts((p) => [{ id: Date.now(), level: 'info', message: okMsg }, ...p].slice(0, 50)); }
    catch (e) { setAlerts((p) => [{ id: Date.now(), level: 'error', message: e.message }, ...p].slice(0, 50)); }
  }, []);

  const openIpAt = useCallback((ip) => { setSelection({ type: 'ip', domainId: view.domainId, ip }); }, [view.domainId]);
  const openTopicAt = useCallback((name) => { setSelection({ type: 'topic', domainId: view.domainId, name }); }, [view.domainId]);
  const openParticipantAt = useCallback((guid) => { setSelection({ type: 'participant', domainId: view.domainId, guid }); }, [view.domainId]);

  const importFile = useCallback((file) => {
    return doAction(async () => {
      const r = await api.importFile(file, file.name);
      setAlerts((p) => [{ id: Date.now(), level: 'info', message: `已导入 ${file.name}（解析 ${r.parsed} 条，新增 ${r.added} 条）` }, ...p].slice(0, 50));
      loadAliases();
    });
  }, [doAction, loadAliases]);

  const center = useMemo(() => {
    switch (view.kind) {
      case 'domain':
        if (view.sub === 'ip-topics') return <IpTopicsView domainId={view.domainId} onSelectIp={openIpAt} />;
        if (view.sub === 'topics') return <TopicListView domainId={view.domainId} revision={revision} onOpenTopic={openTopicAt} />;
        return <DomainDetail domainId={view.domainId} revision={revision} onOpenIp={openIpAt} onOpenParticipant={openParticipantAt} />;
      case 'overview':
      default:
        return (
          <>
            <OverviewCards domains={domains} stats={stats} />
            <DomainList domains={domains} onOpen={(id) => navigate({ kind: 'domain', domainId: id, sub: 'participants' })} />
          </>
        );
    }
  }, [view, domains, stats, revision, openIpAt, openTopicAt, openParticipantAt, navigate]);

  return (
    <TopicRadixContext.Provider value={radix}>
      <AliasContext.Provider value={{ aliases, setAlias, deleteAlias, refreshAliases: loadAliases }}>
        <div className="app-shell">
          <TopBar
            connState={connState}
            watcher={watcher}
            stats={stats}
            radix={radix}
            onRadix={setRadix}
            onImport={importFile}
            onRescan={() => doAction(() => api.scan(), '已触发全量重扫')}
            onDemo={() => doAction(() => api.demoEmit(1), '已生成演示数据')}
            onDemoSlow={() => doAction(() => api.demoSlow(), '已启动慢速写入验证')}
            onClear={() => doAction(() => api.clear(), '已清空缓冲')}
            onConfig={(patch) => doAction(() => api.updateConfig(patch), '配置已更新')}
          />

          <AlertBar alerts={alerts} onDismiss={(id) => setAlerts((p) => p.filter((a) => a.id !== id))} />

          <div className="app-body">
            <Sidebar domains={domains} view={view} onSelect={navigate} />
            <main className="main">{center}</main>
            {selection && (
              <aside className="aside">
                {selection.type === 'topic' && (
                  <TopicDetail domainId={selection.domainId} name={selection.name} onClose={() => setSelection(null)} onOpenIp={openIpAt} />
                )}
                {selection.type === 'ip' && (
                  <DetailPanel title={`节点 ${selection.ip}`} crumbs={[{ label: `域 ${selection.domainId}`, onClick: () => setSelection(null) }]} onClose={() => setSelection(null)}>
                    <IpDetail domainId={selection.domainId} ip={selection.ip} />
                  </DetailPanel>
                )}
                {selection.type === 'participant' && (
                  <ParticipantDetail domainId={selection.domainId} guid={selection.guid} onClose={() => setSelection(null)} onOpenTopic={openTopicAt} onOpenIp={openIpAt} />
                )}
              </aside>
            )}
          </div>
        </div>
      </AliasContext.Provider>
    </TopicRadixContext.Provider>
  );
}
