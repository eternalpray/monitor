import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import DetailPanel from './DetailPanel.jsx';
import { OnlineBadge, KV, Empty, fmtDateTime } from '../ui.jsx';
import { formatTopicName, useTopicRadix } from '../topicName.js';
import { useAliases, aliasLabel } from '../aliases.js';

const LOCATOR_LABELS = [
  ['metatrafficUnicast', 'meta 点播'],
  ['metatrafficMulticast', 'meta 组播'],
  ['defaultUnicast', '数据点播'],
  ['defaultMulticast', '数据组播'],
];

function Locators({ locators }) {
  const has = LOCATOR_LABELS.some(([k]) => (locators && locators[k] && locators[k].length));
  if (!has) return <div className="dim">未上报 locator</div>;
  return (
    <div className="qos-table">
      {LOCATOR_LABELS.map(([k, label]) => (
        <div key={k} className="kv locator-kv">
          <span className="kv-label">{label}</span>
          {(locators[k] || []).map((l, i) => (
            <div key={i} className="locator-line mono">
              {l.type || '—'} :{l.port || '—'} @ {l.address || '—'}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TopicList({ title, list, radix, onOpenTopic }) {
  return (
    <div className="ptopic-section">
      <div className="section-title">{title}（{list.length}）</div>
      {list.length ? (
        <table>
          <thead><tr><th>主题</th><th>类型</th><th>IP</th></tr></thead>
          <tbody>
            {list.map((t, i) => (
              <tr key={t.name + i} onClick={() => onOpenTopic && onOpenTopic(t.name)}>
                <td className="mono">{formatTopicName(t.name, radix)}</td>
                <td className="kind-type">{t.type || '—'}</td>
                <td className="mono">{t.ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty text="无" />}
    </div>
  );
}

// 参与者（节点）详情：GUID / 上线 / 下线 / 供应商 / locator + 发布订阅主题。
export default function ParticipantDetail({ domainId, guid, onClose, onOpenTopic, onOpenIp }) {
  const radix = useTopicRadix();
  const { aliases } = useAliases();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.participant(guid, domainId)
      .then((r) => { setDetail(r); setError(null); })
      .catch((e) => setError(e.message));
  }, [guid, domainId]);

  useEffect(() => { load(); }, [load]);

  return (
    <DetailPanel
      title={detail ? (detail.name || detail.ip || guid) : '节点'}
      crumbs={[{ label: `域 ${domainId}`, onClick: onClose }]}
      onClose={onClose}
    >
      {error ? <Empty text={error} /> : detail ? (
        <>
          <div className="drawer-meta">
            <span>状态 <OnlineBadge online={detail.online} /></span>
            <span>IP <b className="mono link" onClick={() => onOpenIp && onOpenIp(detail.ip)}>{aliasLabel(detail.ip, aliases)}</b></span>
            <span>供应商 <b>{detail.vendorName || detail.vendor || '—'}</b></span>
            <span>RTPS <b className="mono">{detail.rtpsVersion || '—'}</b></span>
          </div>

          <div className="qos-table">
            <KV label="GUID" value={detail.guid} />
            <KV label="名称" value={detail.name} />
            <KV label="厂商标识" value={detail.vendorValue} />
            <KV label="厂商名称" value={detail.vendorName} />
            <KV label="上线时间" value={fmtDateTime(detail.onlineTimestamp)} />
            <KV label="下线时间" value={detail.online ? '—' : fmtDateTime(detail.downlineTimestamp)} />
          </div>

          <div className="section-title">Locator（传输方式 / 端口 / 地址）</div>
          <Locators locators={detail.locators} />

          <TopicList title="发布主题" list={detail.publishedTopics || []} radix={radix} onOpenTopic={onOpenTopic} />
          <TopicList title="订阅主题" list={detail.subscribedTopics || []} radix={radix} onOpenTopic={onOpenTopic} />
        </>
      ) : <Empty text="加载中…" />}
    </DetailPanel>
  );
}
