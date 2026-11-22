import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../api.js';
import { Empty, OnlineBadge, fmtDateTime } from '../ui.jsx';
import { useAliases, aliasLabel } from '../aliases.js';

// 域级视图（解析 participant 部分）：节点统计 + 详细节点（participant）表。
export default function DomainDetail({ domainId, revision, onOpenIp, onOpenParticipant }) {
  const { aliases } = useAliases();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ipFilter, setIpFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.domain(domainId)
      .then((r) => { setDetail(r); setError(null); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [domainId]);

  useEffect(() => { load(); }, [load, revision]);

  const participants = useMemo(() => {
    if (!detail) return [];
    return (detail.participants || []).filter((p) => {
      if (ipFilter && !(p.ip && p.ip.includes(ipFilter))) return false;
      if (statusFilter === 'online' && !p.online) return false;
      if (statusFilter === 'offline' && p.online) return false;
      if (vendorFilter && (p.vendorName || p.vendor || '') !== vendorFilter) return false;
      return true;
    });
  }, [detail, ipFilter, statusFilter, vendorFilter]);

  if (error) return <div className="panel"><Empty text={error} /></div>;

  const s = detail && detail.summary ? detail.summary : null;
  const vendors = detail && detail.vendors ? detail.vendors : [];

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="domain-id">域 {domainId} · 域级视图</span>
        {loading ? <span className="dim">加载中…</span> : null}
      </div>

      {s && (
        <div className="stat-cards">
          <div className="stat-card">
            <div className="stat-card-label">DDS 供应商</div>
            <div className="vendor-chips">
              {vendors.length ? vendors.map((v) => (
                <span key={v.name} className="vendor-chip" title={v.name}>{v.name}<b>{v.count}</b></span>
              )) : <span className="dim">—</span>}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">IP 节点</div>
            <div className="stat-card-value">{s.nodeCount ?? 0}</div>
            <div className="stat-card-sub">在线 <b className="ok">{s.nodeOnlineCount ?? 0}</b> · 离线 <b className="err">{s.nodeOfflineCount ?? 0}</b></div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">域参与者</div>
            <div className="stat-card-value">{s.participantCount ?? 0}</div>
            <div className="stat-card-sub">在线 <b className="ok">{s.participantOnlineCount ?? 0}</b> · 离线 <b className="err">{s.participantOfflineCount ?? 0}</b></div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">端口 / 组播</div>
            <div className="stat-card-value mono small">{s.portRange || '—'}</div>
            <div className="stat-card-sub mono">{s.multicastAddress || '—'}</div>
          </div>
        </div>
      )}

      <div className="filterbar drawer-filter">
        <input placeholder="按节点 IP 过滤" value={ipFilter} onChange={(e) => setIpFilter(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option value="online">在线</option>
          <option value="offline">离线</option>
        </select>
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
          <option value="">全部供应商</option>
          {vendors.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
        </select>
        {(ipFilter || statusFilter || vendorFilter) && (
          <button className="link-btn" onClick={() => { setIpFilter(''); setStatusFilter(''); setVendorFilter(''); }}>清除过滤</button>
        )}
        <span className="filter-count">共 {participants.length} 个节点</span>
      </div>

      <div className="table-scroll">
        {participants.length ? (
          <table>
            <thead>
              <tr>
                <th>节点 IP</th>
                <th>GUID</th>
                <th>名称</th>
                <th>供应商</th>
                <th>上线时间</th>
                <th>下线时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.guid || p.name || p.ip} onClick={() => onOpenParticipant && onOpenParticipant(p.guid)}>
                  <td className="mono link" onClick={(e) => { e.stopPropagation(); onOpenIp && onOpenIp(p.ip); }}>
                    {aliasLabel(p.ip, aliases)}
                  </td>
                  <td className="mono guid-cell" title={p.guid}>{p.guid || '—'}</td>
                  <td>{p.name || '—'}</td>
                  <td title={p.vendorName || ''}>{p.vendorName || p.vendor || '—'}</td>
                  <td className="mono">{fmtDateTime(p.onlineTimestamp)}</td>
                  <td className="mono">{p.online ? '—' : fmtDateTime(p.downlineTimestamp)}</td>
                  <td><OnlineBadge online={p.online} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="该域未发现节点（participant）" />}
      </div>
    </div>
  );
}
