import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../api.js';
import DrawerFrame from './DrawerFrame.jsx';
import { StatusBadge, VerdictBadge, KV, Empty, fmtTime } from '../ui.jsx';

// L1：域详情抽屉。参与者视图 / 主题视图两个 Tab，支持 IP / 主题名 / 状态过滤。
export default function DomainDetail({ domainId, revision, onClose, onOpenParticipant, onOpenTopic }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('participants');
  const [ipFilter, setIpFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ipSuggestions, setIpSuggestions] = useState([]);

  const load = useCallback(() => {
    api.domain(domainId)
      .then((r) => { setDetail(r); setError(null); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [domainId]);

  useEffect(() => { load(); }, [load, revision]);
  useEffect(() => {
    api.ips(domainId).then((r) => setIpSuggestions(r.ips || [])).catch(() => {});
  }, [domainId]);

  const participants = useMemo(() => {
    if (!detail) return [];
    return (detail.participants || []).filter((p) => {
      if (ipFilter && !(p.ip && p.ip.startsWith(ipFilter))) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      return true;
    });
  }, [detail, ipFilter, statusFilter]);

  const topics = useMemo(() => {
    if (!detail) return [];
    return (detail.topics || []).filter((t) => {
      if (nameFilter && !t.name.includes(nameFilter)) return false;
      return true;
    });
  }, [detail, nameFilter]);

  const s = detail && detail.summary ? detail.summary : null;

  return (
    <DrawerFrame
      title={loading ? '加载中…' : `域 ${domainId}`}
      crumbs={[]}
      onClose={onClose}
      width="60%"
      zIndex={100}
    >
      {error ? (
        <Empty text={error} />
      ) : s ? (
        <>
          <div className="domain-summary">
            <div className="summary-main">
              <StatusBadge status={s.status} />
              <span className="dim">参与者 <b>{s.participantCount}</b></span>
              <span className="dim">IP <b>{s.ipCount}</b></span>
              <span className="dim">主题 <b>{s.topicCount}</b></span>
              <span className="dim">写/读 <b>{s.writerCount}/{s.readerCount}</b></span>
              <span className="dim">不兼容主题 <b className={s.incompatibleTopics > 0 ? 'incompat-text' : ''}>{s.incompatibleTopics}</b></span>
            </div>
            <div className="summary-sub dim">最近更新 {fmtTime(s.lastUpdate)}</div>
          </div>

          <div className="drawer-tabs">
            <button className={tab === 'participants' ? 'active' : ''} onClick={() => setTab('participants')}>
              域参与者（{detail.participants.length}）
            </button>
            <button className={tab === 'topics' ? 'active' : ''} onClick={() => setTab('topics')}>
              主题（{detail.topics.length}）
            </button>
          </div>

          <div className="filterbar drawer-filter">
            {tab === 'participants' ? (
              <>
                <input
                  list="ip-suggestions"
                  placeholder="按 IP 过滤（前缀）"
                  value={ipFilter}
                  onChange={(e) => setIpFilter(e.target.value)}
                />
                <datalist id="ip-suggestions">
                  {ipSuggestions.map((ip) => <option key={ip} value={ip} />)}
                </datalist>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">全部状态</option>
                  <option value="OK">OK</option>
                  <option value="WARN">WARN</option>
                  <option value="ERROR">ERROR</option>
                  <option value="UNKNOWN">UNKNOWN</option>
                </select>
              </>
            ) : (
              <input
                placeholder="按主题名过滤"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
              />
            )}
            {(ipFilter || nameFilter || statusFilter) && (
              <button className="link-btn" onClick={() => { setIpFilter(''); setNameFilter(''); setStatusFilter(''); }}>清除过滤</button>
            )}
          </div>

          <div className="list-body">
            {tab === 'participants' ? (
              participants.length ? (
                <table>
                  <thead>
                    <tr><th>名称</th><th>IP</th><th>PID</th><th>状态</th><th>发布主题</th><th>订阅主题</th></tr>
                  </thead>
                  <tbody>
                    {participants.map((p) => (
                      <tr key={p.guid || p.name} onClick={() => onOpenParticipant(p.guid || p.name)}>
                        <td title={p.guid}>{p.name || '—'}</td>
                        <td className="mono">{p.ip || '—'}</td>
                        <td className="mono">{p.pid || '—'}</td>
                        <td><StatusBadge status={p.status} /></td>
                        <td>{p.publishedTopicCount}</td>
                        <td>{p.subscribedTopicCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty text="该 IP 下未发现域参与者" />
            ) : (
              topics.length ? (
                <table>
                  <thead>
                    <tr><th>主题</th><th>类型</th><th>写/读</th><th>兼容性</th><th>最近更新</th></tr>
                  </thead>
                  <tbody>
                    {topics.map((t) => (
                      <tr key={t.name} onClick={() => onOpenTopic(t.name)}>
                        <td className="mono">{t.name}</td>
                        <td className="kind-type">{t.type || '—'}</td>
                        <td>{t.writerCount} / {t.readerCount}</td>
                        <td><VerdictBadge verdict={t.compatVerdict} /></td>
                        <td className="mono">{fmtTime(t.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty text="未找到该主题" />
            )}
          </div>
        </>
      ) : null}
    </DrawerFrame>
  );
}
