import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import DetailPanel from './DetailPanel.jsx';
import IpTopicGraph from './IpTopicGraph.jsx';
import { Empty } from '../ui.jsx';
import { formatTopicName, useTopicRadix } from '../topicName.js';
import { useAliases, aliasLabel } from '../aliases.js';

// 可靠性 → 策略名称（可靠=一次性策略，尽力=周期性策略）
function policyName(reliability) {
  if (reliability === 'RELIABLE') return '一次性策略';
  if (reliability === 'BEST_EFFORT') return '周期性策略';
  return '—';
}

function nodeName(ep) {
  const n = (ep.entityName || '').trim();
  if (n && n !== 'Unknown Name') return n;
  return ep.ip || '—';
}

function ownershipText(qos) {
  if (!qos || qos.ownership == null) return '—';
  return qos.ownershipStrength != null ? `${qos.ownership} (${qos.ownershipStrength})` : qos.ownership;
}

// 主题交互视图详情：主题居中交互图 + 发送/接收方明细表。
export default function TopicDetail({ domainId, name, onClose, onOpenIp }) {
  const radix = useTopicRadix();
  const { aliases } = useAliases();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.topic(domainId, name)
      .then((r) => { setDetail(r); setError(null); })
      .catch((e) => setError(e.message));
  }, [domainId, name]);

  useEffect(() => { load(); }, [load]);

  const rows = detail ? [
    ...(detail.writers || []).map((e) => ({ ...e, role: 'writer' })),
    ...(detail.readers || []).map((e) => ({ ...e, role: 'reader' })),
  ] : [];

  return (
    <DetailPanel
      title={formatTopicName(name, radix)}
      crumbs={[{ label: `域 ${domainId}`, onClick: onClose }]}
      onClose={onClose}
    >
      {error ? <Empty text={error} /> : detail ? (
        <>
          <div className="drawer-meta">
            <span>类型 <b className="kind-type">{Array.isArray(detail.type) ? detail.type.join(', ') : detail.type || '—'}</b></span>
            <span>发送节点 <b>{detail.sendIps.length}</b> · 接收节点 <b>{detail.receiveIps.length}</b></span>
          </div>

          <div className="section-title">主题交互图（发送节点 / 主题 / 接收节点）</div>
          <div className="graph-wrap">
            <IpTopicGraph topic={{ name: detail.name, sendIps: detail.sendIps, receiveIps: detail.receiveIps }} />
          </div>

          <div className="section-title">发送 / 接收方明细（{rows.length}）</div>
          {rows.length ? (
            <div className="drawer-table">
              <table>
                <thead>
                  <tr>
                    <th>角色</th><th>节点名称</th><th>IP</th><th>GUID</th><th>数据类型</th>
                    <th>策略名称</th><th>可靠性</th><th>持久化</th><th>所有权/权重</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e, i) => (
                    <tr key={e.guid || i}>
                      <td className={e.role === 'writer' ? 'role-w' : 'role-r'}>{e.role === 'writer' ? '发送' : '接收'}</td>
                      <td>{nodeName(e)}</td>
                      <td className="mono link" onClick={() => onOpenIp && onOpenIp(e.ip)}>{aliasLabel(e.ip, aliases)}</td>
                      <td className="mono guid-cell" title={e.guid}>{e.guid || '—'}</td>
                      <td className="kind-type">{e.type || '—'}</td>
                      <td>{policyName(e.qos && e.qos.reliability)}</td>
                      <td className="mono">{e.qos && e.qos.reliability ? e.qos.reliability : '—'}</td>
                      <td className="mono">{e.qos && e.qos.durability ? e.qos.durability : '—'}</td>
                      <td className="mono">{ownershipText(e.qos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty text="该主题无发送/接收方" />}
        </>
      ) : <Empty text="加载中…" />}
    </DetailPanel>
  );
}
