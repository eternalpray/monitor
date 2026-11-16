import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import DrawerFrame from './DrawerFrame.jsx';
import { StatusBadge, KV, Empty, fmtTime } from '../ui.jsx';

function QosTable({ qos }) {
  const entries = qos ? Object.entries(qos) : [];
  if (!entries.length) return <div className="dim">未上报 QoS</div>;
  return (
    <div className="qos-table">
      {entries.map(([k, v]) => (
        <KV key={k} label={k} value={Array.isArray(v) ? v.join(', ') : v} />
      ))}
    </div>
  );
}

function TopicList({ title, list, onOpenTopic }) {
  return (
    <div className="ptopic-section">
      <div className="section-title">{title}（{list.length}）</div>
      {list.length ? (
        <table>
          <thead><tr><th>主题</th><th>类型</th><th>IP</th><th>状态</th><th>样本速率</th></tr></thead>
          <tbody>
            {list.map((t, i) => (
              <tr key={t.name + i} onClick={() => onOpenTopic && onOpenTopic(t.name)}>
                <td className="mono">{t.name}</td>
                <td className="kind-type">{t.type || '—'}</td>
                <td className="mono">{t.ip || '—'}</td>
                <td><StatusBadge status={t.status} /></td>
                <td className="mono">{t.sampleRate != null ? t.sampleRate : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty text="无" />}
    </div>
  );
}

// L2-B：域参与者详情
export default function ParticipantDetail({ domainId, guid, onClose, onBack, onOpenTopic }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.participant(guid, domainId)
      .then((r) => { setDetail(r); setError(null); })
      .catch((e) => setError(e.message));
  }, [guid, domainId]);

  useEffect(() => { load(); }, [load]);

  return (
    <DrawerFrame
      title={detail ? (detail.name || guid) : '参与者'}
      crumbs={[{ label: `域 ${domainId}`, onClick: onBack }]}
      onClose={onClose}
      width="55%"
      zIndex={110}
    >
      {error ? <Empty text={error} /> : detail ? (
        <>
          <div className="drawer-meta">
            <span>GUID <b className="mono">{detail.guid || '—'}</b></span>
            <span>IP <b className="mono">{detail.ip || '—'}</b></span>
            <span>主机 <b>{detail.host || '—'}</b></span>
            <span>PID <b>{detail.pid || '—'}</b></span>
            <span>状态 <StatusBadge status={detail.status} /></span>
            <span>最近出现 <b>{fmtTime(detail.lastSeen)}</b></span>
          </div>

          <div className="section-title">QoS 明细</div>
          <QosTable qos={detail.qos} />

          <TopicList title="发布主题" list={detail.publishedTopics || []} onOpenTopic={onOpenTopic} />
          <TopicList title="订阅主题" list={detail.subscribedTopics || []} onOpenTopic={onOpenTopic} />
        </>
      ) : <Empty text="加载中…" />}
    </DrawerFrame>
  );
}
