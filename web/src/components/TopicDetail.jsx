import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import DrawerFrame from './DrawerFrame.jsx';
import CompatibilityPanel from './CompatibilityPanel.jsx';
import IpTopicGraph from './IpTopicGraph.jsx';
import { VerdictBadge, StatusBadge, Empty, fmtTime } from '../ui.jsx';

function IpList({ title, list, color }) {
  return (
    <div className="ip-list">
      <div className="section-title">{title}（{list.length}）</div>
      {list.length ? (
        <table>
          <thead><tr><th>IP</th><th>端点 GUID</th><th>参与者</th><th>QoS 摘要</th><th>状态</th><th>样本速率</th></tr></thead>
          <tbody>
            {list.map((e, i) => (
              <tr key={e.guid || i}>
                <td className="mono" style={{ color }}>{e.ip || '—'}</td>
                <td className="mono guid-cell" title={e.guid}>{e.guid || '—'}</td>
                <td>{e.participantName || '—'}</td>
                <td className="qos-summary">{qosSummary(e.qos)}</td>
                <td><StatusBadge status={e.status} /></td>
                <td className="mono">{e.sampleRate != null ? e.sampleRate : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty text="无" />}
    </div>
  );
}

function qosSummary(qos) {
  if (!qos) return '—';
  const keys = ['reliability', 'durability', 'deadline', 'liveliness', 'ownership'];
  const parts = keys.filter((k) => qos[k] != null).map((k) => `${k}=${Array.isArray(qos[k]) ? qos[k].join(',') : qos[k]}`);
  return parts.length ? parts.join(' ') : '—';
}

// L2-C：主题详情（发送 / 接收 IP + 收发关系图 + 兼容性分析）
export default function TopicDetail({ domainId, name, onClose, onBack }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.topic(domainId, name)
      .then((r) => { setDetail(r); setError(null); })
      .catch((e) => setError(e.message));
  }, [domainId, name]);

  useEffect(() => { load(); }, [load]);

  return (
    <DrawerFrame
      title={name}
      crumbs={[{ label: `域 ${domainId}`, onClick: onBack }]}
      onClose={onClose}
      width="58%"
      zIndex={110}
    >
      {error ? <Empty text={error} /> : detail ? (
        <>
          <div className="drawer-meta">
            <span>类型 <b className="kind-type">{Array.isArray(detail.type) ? detail.type.join(', ') : detail.type || '—'}</b></span>
            <span>分区 <b>{Array.isArray(detail.partition) ? detail.partition.join(', ') : detail.partition || '—'}</b></span>
            <span>兼容性 <VerdictBadge verdict={detail.compatibility.verdict} /></span>
            <span>发送 IP <b>{detail.sendIps.length}</b> · 接收 IP <b>{detail.receiveIps.length}</b></span>
            {detail.multiType && <span className="dim">存在同名不同类型</span>}
          </div>

          <div className="section-title">收发关系图</div>
          <div className="graph-wrap">
            <IpTopicGraph topic={detail} />
          </div>

          <IpList title="发送 IP" list={detail.writers || []} color="#2fbf8f" />
          <IpList title="接收 IP" list={detail.readers || []} color="#5b7cc4" />

          {detail.unknownIpEndpointCount > 0 && (
            <div className="dim unknown-ip-hint">{detail.unknownIpEndpointCount} 个端点未上报 IP</div>
          )}

          <div className="section-title">兼容性分析（writer × reader）</div>
          <CompatibilityPanel compatibility={detail.compatibility} />
        </>
      ) : <Empty text="加载中…" />}
    </DrawerFrame>
  );
}
